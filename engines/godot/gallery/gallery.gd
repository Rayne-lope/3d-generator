extends Node3D
## Gallery of the golden GLBs, loaded at runtime with GLTFDocument (the path a game uses).
##
## Interactive: open engines/godot in Godot 4.3+ and press F5. Drag to orbit, wheel to zoom.
## Each item is scaled to fit its cell; the label shows its true size.
##
## Capture modes (used by `node studio engine-verify godot --capture`):
##   godot --path engines/godot -- --capture=res://verify/gallery.png
##   godot --path engines/godot --resolution 512x512 -- --capture-items=res://verify/items
## --capture-items renders every item alone at true scale from the studio's "iso" camera
## direction, so the images can be compared with the studio viewport renders.

const MANIFEST := "res://golden/manifest.json"
const ISO_DIR := Vector3(0.62, 0.48, 0.62)
const CELL := 2.4
const FIT := 1.6

var _camera: Camera3D
var _orbit := Vector2(-0.6, 0.7)  # pitch, yaw
var _distance := 12.0
var _target := Vector3.ZERO


func _ready() -> void:
	_setup_environment()
	_camera = Camera3D.new()
	_camera.fov = 30.0
	add_child(_camera)
	if not FileAccess.file_exists(MANIFEST):
		var label := Label3D.new()
		label.text = "No golden files yet.\nRun: node studio engine-pack godot"
		add_child(label)
		_camera.position = Vector3(0, 0, 4)
		return
	var manifest = JSON.parse_string(FileAccess.get_file_as_string(MANIFEST))
	var args := _user_args()
	if args.has("capture-items"):
		await _capture_items(manifest["items"], str(args["capture-items"]))
		get_tree().quit()
		return
	_build_grid(manifest["items"])
	if args.has("capture"):
		await _wait_frames(10)
		get_viewport().get_texture().get_image().save_png(_abs(str(args["capture"])))
		get_tree().quit()


func _setup_environment() -> void:
	# Same rig as the studio viewport's "Neutral" lighting (studio/viewport/scene-setup.js):
	# gray gradient environment, key light from (0.55, 1, 0.75), cool fill from (-0.8, 0.35, -0.6),
	# no tone mapping. three.js divides direct light by PI (physically based units) and Godot does not,
	# so the energies are the studio intensities / PI.
	# The viewport's environment is a plain gray gradient (light above, darker below); a
	# procedural sky with the same colors gives Godot the same ambient light and reflections.
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color("#d9dde3")
	sky_mat.sky_horizon_color = Color("#9a9ea5")
	sky_mat.ground_horizon_color = Color("#9a9ea5")
	sky_mat.ground_bottom_color = Color("#4a4743")
	sky_mat.sun_angle_max = 0.0
	sky_mat.energy_multiplier = 0.85
	var sky := Sky.new()
	sky.sky_material = sky_mat
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color("#4b5057")
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	var world := WorldEnvironment.new()
	world.environment = env
	add_child(world)
	var key := DirectionalLight3D.new()
	key.light_energy = 1.7 / PI
	add_child(key)
	key.look_at_from_position(Vector3(0.55, 1.0, 0.75), Vector3.ZERO, Vector3.UP)
	var fill := DirectionalLight3D.new()
	fill.light_color = Color("#dfe6ff")
	fill.light_energy = 0.45 / PI
	add_child(fill)
	fill.look_at_from_position(Vector3(-0.8, 0.35, -0.6), Vector3.ZERO, Vector3.UP)


func _build_grid(items: Array) -> void:
	var columns := ceili(sqrt(float(items.size())))
	for i in items.size():
		var item: Dictionary = items[i]
		var node := _load(str(item["file"]))
		if node == null:
			continue
		var holder := Node3D.new()
		add_child(holder)
		holder.add_child(node)
		var box := _bounds(node, Transform3D.IDENTITY)
		var largest := maxf(box.size.x, maxf(box.size.y, box.size.z))
		var s := FIT / maxf(largest, 0.001)
		var cell := Vector3((i % columns) * CELL, 0, (i / columns) * CELL)
		holder.scale = Vector3.ONE * s
		holder.position = cell - Vector3(box.get_center().x, box.position.y, box.get_center().z) * s
		var label := Label3D.new()
		label.text = "%s\n%.2f × %.2f × %.2f m" % [item["id"], box.size.x, box.size.y, box.size.z]
		label.font_size = 28
		label.pixel_size = 0.004
		label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		label.position = cell + Vector3(0, -0.15, CELL * 0.35)
		add_child(label)
	var rows := ceili(float(items.size()) / columns)
	_target = Vector3((columns - 1) * CELL / 2.0, 0.5, (rows - 1) * CELL / 2.0)
	_distance = maxf(columns, rows) * CELL * 1.6
	_update_camera()


func _capture_items(items: Array, out_dir: String) -> void:
	get_window().size = Vector2i(512, 512)
	DirAccess.make_dir_recursive_absolute(_abs(out_dir))
	for item in items:
		var node := _load(str(item["file"]))
		if node == null:
			continue
		add_child(node)
		_frame(_bounds(node, Transform3D.IDENTITY), ISO_DIR)
		await _wait_frames(4)
		var img := get_viewport().get_texture().get_image()
		img.save_png(_abs(out_dir).path_join(str(item["id"]) + ".png"))
		remove_child(node)
		node.queue_free()


func _load(file: String) -> Node3D:
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	if doc.append_from_file(ProjectSettings.globalize_path("res://golden/" + file), state) != OK:
		push_warning("could not load " + file)
		return null
	return doc.generate_scene(state) as Node3D


func _bounds(node: Node, parent_xf: Transform3D) -> AABB:
	var xf := parent_xf
	if node is Node3D:
		xf = parent_xf * (node as Node3D).transform
	var box := AABB()
	var has := false
	if node is MeshInstance3D and (node as MeshInstance3D).mesh != null:
		var local: AABB = (node as MeshInstance3D).mesh.get_aabb()
		for c in 8:
			var p: Vector3 = xf * local.get_endpoint(c)
			box = AABB(p, Vector3.ZERO) if not has else box.expand(p)
			has = true
	for child in node.get_children():
		var b := _bounds(child, xf)
		if b.size != Vector3.ZERO or b.position != Vector3.ZERO:
			box = b if not has else box.merge(b)
			has = true
	return box


## Same framing as the studio's frameCamera: fit the 8 box corners from a view direction.
func _frame(box: AABB, view_dir: Vector3) -> void:
	var center := box.get_center()
	var dir := view_dir.normalized()
	var right := Vector3.UP.cross(dir).normalized()
	var up := dir.cross(right).normalized()
	var tan_v := tan(deg_to_rad(_camera.fov) / 2.0)
	var aspect := float(get_viewport().get_visible_rect().size.x) / float(get_viewport().get_visible_rect().size.y)
	var tan_h := tan_v * aspect
	var dist := 0.001
	for c in 8:
		var corner := box.get_endpoint(c) - center
		var depth := corner.dot(dir)
		dist = maxf(dist, maxf(depth + absf(corner.dot(right)) / tan_h, depth + absf(corner.dot(up)) / tan_v))
	dist *= 1.08
	_camera.near = maxf(dist / 1000.0, 0.001)
	_camera.far = dist + box.size.length() * 4.0
	_camera.look_at_from_position(center + dir * dist, center, up)


func _update_camera() -> void:
	var offset := Vector3(cos(_orbit.x) * sin(_orbit.y), -sin(_orbit.x), cos(_orbit.x) * cos(_orbit.y)) * _distance
	_camera.far = _distance * 10.0
	_camera.look_at_from_position(_target + offset, _target, Vector3.UP)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and (event.button_mask & MOUSE_BUTTON_MASK_LEFT):
		_orbit.y -= event.relative.x * 0.005
		_orbit.x = clampf(_orbit.x - event.relative.y * 0.005, -1.5, 0.2)
		_update_camera()
	elif event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_distance *= 0.9
			_update_camera()
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_distance *= 1.1
			_update_camera()


func _user_args() -> Dictionary:
	var out := {}
	for a in OS.get_cmdline_user_args():
		var s := str(a).trim_prefix("--")
		var eq := s.find("=")
		if eq > 0:
			out[s.substr(0, eq)] = s.substr(eq + 1)
		else:
			out[s] = true
	return out


func _wait_frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame


func _abs(p: String) -> String:
	return ProjectSettings.globalize_path(p) if p.begins_with("res://") or p.begins_with("user://") else p
