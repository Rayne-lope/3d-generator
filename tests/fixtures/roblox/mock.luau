-- A very small stand-in for the Roblox API, enough to run generated setup modules in the
-- standalone Luau CLI: Vector3, CFrame (as position + three axis vectors), Instance, Enum.
-- It checks the module's own logic and math; it says nothing about how Roblox Studio imports.

local Vector3 = {}
Vector3.__index = function(self, key)
	if key == "Magnitude" then
		return math.sqrt(self.X * self.X + self.Y * self.Y + self.Z * self.Z)
	elseif key == "Unit" then
		local m = math.sqrt(self.X * self.X + self.Y * self.Y + self.Z * self.Z)
		return Vector3.new(self.X / m, self.Y / m, self.Z / m)
	end
	return rawget(Vector3, key)
end
function Vector3.new(x, y, z)
	return setmetatable({ X = x or 0, Y = y or 0, Z = z or 0 }, Vector3)
end
Vector3.__add = function(a, b) return Vector3.new(a.X + b.X, a.Y + b.Y, a.Z + b.Z) end
Vector3.__sub = function(a, b) return Vector3.new(a.X - b.X, a.Y - b.Y, a.Z - b.Z) end
Vector3.__unm = function(a) return Vector3.new(-a.X, -a.Y, -a.Z) end
Vector3.__mul = function(a, b)
	if type(a) == "number" then return Vector3.new(a * b.X, a * b.Y, a * b.Z) end
	if type(b) == "number" then return Vector3.new(a.X * b, a.Y * b, a.Z * b) end
	return Vector3.new(a.X * b.X, a.Y * b.Y, a.Z * b.Z)
end
function Vector3:Cross(b)
	return Vector3.new(self.Y * b.Z - self.Z * b.Y, self.Z * b.X - self.X * b.Z, self.X * b.Y - self.Y * b.X)
end

local CFrame = {}
CFrame.__index = function(self, key)
	if key == "Position" then return self.p end
	if key == "LookVector" then return -self.z end
	if key == "RightVector" then return self.x end
	if key == "UpVector" then return self.y end
	return rawget(CFrame, key)
end
local function cf(p, x, y, z)
	return setmetatable({ p = p, x = x, y = y, z = z }, CFrame)
end
local function rotate(c, v)
	return c.x * v.X + c.y * v.Y + c.z * v.Z
end
function CFrame.new(a, b, c)
	local p = type(a) == "number" and Vector3.new(a, b, c) or (a or Vector3.new())
	return cf(p, Vector3.new(1, 0, 0), Vector3.new(0, 1, 0), Vector3.new(0, 0, 1))
end
function CFrame.fromMatrix(p, x, y, z)
	return cf(p, x, y, z or x:Cross(y))
end
-- Same order as Roblox: rotation = Rx * Ry * Rz.
function CFrame.Angles(rx, ry, rz)
	local function axis(c, s, i)
		if i == 1 then return cf(Vector3.new(), Vector3.new(1, 0, 0), Vector3.new(0, c, s), Vector3.new(0, -s, c)) end
		if i == 2 then return cf(Vector3.new(), Vector3.new(c, 0, -s), Vector3.new(0, 1, 0), Vector3.new(s, 0, c)) end
		return cf(Vector3.new(), Vector3.new(c, s, 0), Vector3.new(-s, c, 0), Vector3.new(0, 0, 1))
	end
	return axis(math.cos(rx), math.sin(rx), 1) * axis(math.cos(ry), math.sin(ry), 2) * axis(math.cos(rz), math.sin(rz), 3)
end
function CFrame.lookAt(at, target, up)
	local look = (target - at).Unit
	local right = look:Cross(up or Vector3.new(0, 1, 0)).Unit
	return cf(at, right, right:Cross(look), -look)
end
CFrame.__mul = function(a, b)
	if getmetatable(b) == Vector3 then
		return a.p + rotate(a, b)
	end
	return cf(a.p + rotate(a, b.p), rotate(a, b.x), rotate(a, b.y), rotate(a, b.z))
end
function CFrame:VectorToWorldSpace(v)
	return rotate(self, v)
end

local BASE_PARTS = { Part = true, MeshPart = true }
local Instance = {}
local InstanceMeta = {}
InstanceMeta.__index = function(self, key)
	if key == "Position" then return rawget(self, "CFrame").Position end
	local value = rawget(self, "_props")[key]
	if value ~= nil then return value end
	return Instance[key]
end
InstanceMeta.__newindex = function(self, key, value)
	if key == "Parent" then
		local old = rawget(self, "_props").Parent
		if old then
			for i, child in ipairs(rawget(old, "_children")) do
				if child == self then table.remove(rawget(old, "_children"), i) break end
			end
		end
		rawget(self, "_props").Parent = value
		if value then table.insert(rawget(value, "_children"), self) end
	elseif key == "WorldCFrame" or key == "CFrame" then
		rawset(self, key, value)
	else
		rawget(self, "_props")[key] = value
	end
end
function Instance.new(class)
	return setmetatable({ _class = class, _props = { Name = class, Anchored = false, CanCollide = true }, _children = {}, _attributes = {}, CFrame = CFrame.new() }, InstanceMeta)
end
function Instance:IsA(class)
	local own = rawget(self, "_class")
	return own == class or (class == "BasePart" and BASE_PARTS[own] == true) or class == "Instance"
end
function Instance:GetChildren()
	return rawget(self, "_children")
end
function Instance:GetDescendants()
	local out = {}
	local function walk(node)
		for _, child in ipairs(rawget(node, "_children")) do
			table.insert(out, child)
			walk(child)
		end
	end
	walk(self)
	return out
end
function Instance:GetAttribute(name) return rawget(self, "_attributes")[name] end
function Instance:SetAttribute(name, value) rawget(self, "_attributes")[name] = value end
function Instance:Destroy() self.Parent = nil end
function Instance:FindFirstChild(name)
	for _, child in ipairs(rawget(self, "_children")) do
		if child.Name == name then return child end
	end
	return nil
end
-- The test sets Box = { cframe, size } on the model: the truth of the simulated import.
function Instance:GetBoundingBox()
	local box = rawget(self, "_props").Box
	return box.cframe, box.size
end

local realTypeof = typeof
local function mockTypeof(value)
	if getmetatable(value) == InstanceMeta then return "Instance" end
	return realTypeof(value)
end

return {
	Vector3 = Vector3,
	CFrame = CFrame,
	Instance = { new = Instance.new },
	Enum = { PartType = { Block = "Block", Ball = "Ball", Cylinder = "Cylinder" } },
	typeof = mockTypeof,
}
