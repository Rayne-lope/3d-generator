extends SceneTree
## Golden set check for Godot 4.3+.
##
## Loads every GLB listed in res://golden/manifest.json at runtime with GLTFDocument (the same
## loader the editor import uses) and compares what Godot sees with what the studio exported:
## size and base height, triangles, mesh and surface counts, node pivots, material colors,
## metallic/roughness, texture slots, transparency and culling.
##
## Prepare the files first:   node studio engine-pack godot
## Run headless:              godot --headless --path engines/godot --script res://verify/verify_golden.gd
## (or simply:                node studio engine-verify godot)
##
## Writes res://verify/report.json and exits with code 1 when an item fails.

const MANIFEST := "res://golden/manifest.json"
const REPORT := "res://verify/report.json"


func _initialize() -> void:
	quit(_run())


func _run() -> int:
	if not FileAccess.file_exists(MANIFEST):
		printerr("Missing %s. Run: node studio engine-pack godot" % MANIFEST)
		return 2
	var manifest = JSON.parse_string(FileAccess.get_file_as_string(MANIFEST))
	if typeof(manifest) != TYPE_DICTIONARY or not manifest.has("items"):
		printerr("%s is not a valid manifest" % MANIFEST)
		return 2
	var tol: Dictionary = manifest.get("tolerance", {})
	var results: Array = []
	var passed := 0
	for item in manifest["items"]:
		var r := _verify(item, tol)
		results.append(r)
		if r["ok"]:
			passed += 1
			print("PASS  %s" % item["id"])
		else:
			print("FAIL  %s  %s" % [item["id"], "; ".join(PackedStringArray(r["problems"]))])
	var version: String = Engine.get_version_info()["string"]
	var report := {
		"godotVersion": version,
		"finishedAt": Time.get_datetime_string_from_system(true) + "Z",
		"manifestGeneratedAt": manifest.get("generatedAt", ""),
		"total": results.size(),
		"passed": passed,
		"failed": results.size() - passed,
		"items": results,
	}
	var f := FileAccess.open(REPORT, FileAccess.WRITE)
	if f != null:
		f.store_string(JSON.stringify(report, "  "))
		f.close()
	print("Godot %s: %d/%d golden items passed" % [version, passed, results.size()])
	return 0 if passed == results.size() else 1


func _verify(item: Dictionary, tol: Dictionary) -> Dictionary:
	var problems: Array = []
	var path := ProjectSettings.globalize_path("res://golden/" + str(item["file"]))
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_file(path, state)
	if err != OK:
		return {"id": item["id"], "ok": false, "problems": ["GLTFDocument.append_from_file failed: %s" % error_string(err)]}
	var root: Node = doc.generate_scene(state)
	if root == null:
		return {"id": item["id"], "ok": false, "problems": ["GLTFDocument.generate_scene returned null"]}

	var stats := {"meshes": 0, "surfaces": 0, "triangles": 0, "has_box": false, "box": AABB(), "materials": {}, "nodes": {}}
	_collect(root, Transform3D.IDENTITY, stats)
	root.free()

	var abs_tol: float = tol.get("size", 0.002)
	var rel_tol: float = tol.get("sizeRel", 0.005)
	var color_tol: float = tol.get("color", 0.012)
	var factor_tol: float = tol.get("factor", 0.01)

	# Size and base (meters; Godot uses 1 unit = 1 m, +Y up, like the export).
	var box: AABB = stats["box"]
	var expected_size := Vector3(item["sizeMeters"][0], item["sizeMeters"][1], item["sizeMeters"][2])
	for axis in 3:
		if absf(box.size[axis] - expected_size[axis]) > maxf(abs_tol, expected_size[axis] * rel_tol):
			problems.append("size %s m, expected %s m" % [_v3(box.size), _v3(expected_size)])
			break
	var expected_min := Vector3(item["boundsMin"][0], item["boundsMin"][1], item["boundsMin"][2])
	if box.position.distance_to(expected_min) > maxf(abs_tol, expected_size.length() * rel_tol):
		problems.append("bounds start at %s, expected %s (origin/pivot moved)" % [_v3(box.position), _v3(expected_min)])

	# Geometry counts.
	if int(stats["triangles"]) != int(item["triangles"]):
		problems.append("%d triangles, expected %d" % [stats["triangles"], item["triangles"]])
	if int(stats["meshes"]) != int(item["meshes"]):
		problems.append("%d mesh nodes, expected %d" % [stats["meshes"], item["meshes"]])
	if int(stats["surfaces"]) != int(item["surfaces"]):
		problems.append("%d surfaces, expected %d" % [stats["surfaces"], item["surfaces"]])

	# Pivots of mesh nodes (separate parts keep their hinge/axle position).
	for n in item["nodes"]:
		var name := str(n["name"])
		if not stats["nodes"].has(name):
			problems.append("node '%s' missing" % name)
			continue
		var expected_pos := Vector3(n["translation"][0], n["translation"][1], n["translation"][2])
		var got_pos: Vector3 = stats["nodes"][name]
		if got_pos.distance_to(expected_pos) > abs_tol:
			problems.append("node '%s' at %s, expected %s" % [name, _v3(got_pos), _v3(expected_pos)])

	# Materials.
	for m in item["materials"]:
		var mname := str(m["name"])
		if not stats["materials"].has(mname):
			problems.append("material '%s' missing" % mname)
			continue
		var mat = stats["materials"][mname]
		if not (mat is BaseMaterial3D):
			problems.append("material '%s' is %s, expected a StandardMaterial3D" % [mname, mat.get_class()])
			continue
		var bm := mat as BaseMaterial3D
		var expected_color := Color.html(str(m["baseColor"]))
		var got: Color = bm.albedo_color
		if absf(got.r - expected_color.r) > color_tol or absf(got.g - expected_color.g) > color_tol or absf(got.b - expected_color.b) > color_tol:
			problems.append("material '%s' albedo #%s, expected %s" % [mname, got.to_html(false), str(m["baseColor"])])
		if absf(got.a - float(m["alpha"])) > color_tol:
			problems.append("material '%s' alpha %.3f, expected %.3f" % [mname, got.a, float(m["alpha"])])
		if absf(bm.metallic - float(m["metallic"])) > factor_tol:
			problems.append("material '%s' metallic %.3f, expected %.3f" % [mname, bm.metallic, float(m["metallic"])])
		if absf(bm.roughness - float(m["roughness"])) > factor_tol:
			problems.append("material '%s' roughness %.3f, expected %.3f" % [mname, bm.roughness, float(m["roughness"])])
		var maps: Array = m["maps"]
		if maps.has("baseColor") and bm.albedo_texture == null:
			problems.append("material '%s' lost its color texture" % mname)
		if maps.has("normal") and (not bm.normal_enabled or bm.normal_texture == null):
			problems.append("material '%s' lost its normal map" % mname)
		if maps.has("metallicRoughness") and bm.roughness_texture == null:
			problems.append("material '%s' lost its metallic/roughness texture" % mname)
		if maps.has("occlusion") and bm.ao_texture == null:
			problems.append("material '%s' lost its occlusion texture" % mname)
		if maps.has("emissive") and bm.emission_texture == null:
			problems.append("material '%s' lost its emissive texture" % mname)
		if m["emissive"] != null and not bm.emission_enabled:
			problems.append("material '%s' is not emissive in Godot" % mname)
		var mode := str(m["alphaMode"])
		var tr := bm.transparency
		if mode == "OPAQUE" and tr != BaseMaterial3D.TRANSPARENCY_DISABLED:
			problems.append("material '%s' became transparent (mode %d)" % [mname, tr])
		elif mode == "MASK" and tr != BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR:
			problems.append("material '%s' alpha mask became mode %d" % [mname, tr])
		elif mode == "BLEND" and tr == BaseMaterial3D.TRANSPARENCY_DISABLED:
			problems.append("material '%s' lost alpha blending" % mname)
		if bm.cull_mode != BaseMaterial3D.CULL_BACK:
			problems.append("material '%s' is not back-face culled (cull mode %d)" % [mname, bm.cull_mode])

	return {
		"id": item["id"],
		"ok": problems.is_empty(),
		"problems": problems,
		"measured": {
			"sizeMeters": [box.size.x, box.size.y, box.size.z],
			"boundsMin": [box.position.x, box.position.y, box.position.z],
			"triangles": stats["triangles"],
			"meshes": stats["meshes"],
			"surfaces": stats["surfaces"],
			"materials": stats["materials"].keys(),
		},
	}


func _collect(node: Node, parent_xf: Transform3D, stats: Dictionary) -> void:
	var xf := parent_xf
	if node is Node3D:
		xf = parent_xf * (node as Node3D).transform
	var mesh := _mesh_of(node)
	if mesh != null:
		stats["meshes"] += 1
		stats["nodes"][String(node.name)] = (node as Node3D).position
		for i in mesh.get_surface_count():
			stats["surfaces"] += 1
			var arrays: Array = mesh.surface_get_arrays(i)
			var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var indices = arrays[Mesh.ARRAY_INDEX]
			var count: int = verts.size()
			if indices != null and indices.size() > 0:
				count = indices.size()
			stats["triangles"] += count / 3
			for v in verts:
				var p: Vector3 = xf * v
				if not stats["has_box"]:
					stats["box"] = AABB(p, Vector3.ZERO)
					stats["has_box"] = true
				else:
					stats["box"] = (stats["box"] as AABB).expand(p)
			var mat := mesh.surface_get_material(i)
			if mat != null:
				stats["materials"][mat.resource_name] = mat
	for child in node.get_children():
		_collect(child, xf, stats)


func _mesh_of(node: Node) -> Mesh:
	if node is MeshInstance3D:
		return (node as MeshInstance3D).mesh
	if node is ImporterMeshInstance3D:
		var im: ImporterMesh = (node as ImporterMeshInstance3D).mesh
		return im.get_mesh() if im != null else null
	return null


func _v3(v: Vector3) -> String:
	return "(%.3f, %.3f, %.3f)" % [v.x, v.y, v.z]
