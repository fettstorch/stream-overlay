-- mGBA native TCP sockets; no external Lua dependencies and no file output.
-- Connect is blocking in mGBA. Keep one connection and back off after failures.
local connection = nil
local pending = nil
local sentIndex = 1
local response = ""
local deadline = 0
local retryAt = 0
local delay = 2
local stopped = false
local acknowledged = false
local function socketCall(method, ...)
  local ok, value, reason = pcall(method, ...)
  if not ok then return nil, "socket exception" end
  return value, reason
end
local function temporary(reason)
  return reason == "temporary failure" or reason == "no data"
    or (socket.ERRORS and (reason == socket.ERRORS.AGAIN or reason == socket.ERRORS.NO_DATA))
end
local function closeHttp()
  if connection then pcall(function() connection:close() end) end
  connection = nil; pending = nil; response = ""; sentIndex = 1
end
local function failHttp(stage)
  closeHttp()
  retryAt = os.time() + delay
  delay = math.min(60, delay * 2)
  acknowledged = false
  console:warn("Crystal cloud transport failed: " .. (stage or "socket") .. "; retrying with backoff")
end
local function httpReady()
  return not stopped and pending == nil and os.time() >= retryAt
end
local function sendHttp(body)
  if not httpReady() then return false end
  if not connection then
    if not socket or not socket.connect then
      stopped = true; console:error("Crystal cloud requires mGBA's native Lua socket API")
      return false
    end
    connection = socketCall(socket.connect, ingestHost, ingestPort)
    if not connection then failHttp("connect"); return false end
  end
  pending = "POST " .. ingestPath .. " HTTP/1.1\r\nHost: " .. ingestHostHeader .. "\r\nContent-Type: application/json\r\nContent-Length: " .. #body .. "\r\nConnection: keep-alive\r\n\r\n" .. body
  sentIndex = 1; response = ""; deadline = os.time() + 10
  return true
end
local function pumpHttp()
  if not pending then return end
  if os.time() > deadline then failHttp("response timeout"); return end
  if sentIndex <= #pending then
    local last, reason = socketCall(function() return connection:send(pending, sentIndex) end)
    if type(last) == "number" and last >= sentIndex - 1 and last <= #pending then sentIndex = last + 1
    elseif not temporary(reason) then failHttp("send"); return end
  end
  if sentIndex <= #pending then return end
  local ready, reason = socketCall(function() return connection:hasdata() end)
  if reason then if not temporary(reason) then failHttp("poll") end; return end
  if not ready then return end
  local bytes, receiveReason = socketCall(function() return connection:receive(4096) end)
  if not bytes then if not temporary(receiveReason) then failHttp("receive") end; return end
  if bytes == "" then failHttp("disconnected"); return end
  response = response .. bytes
  if #response > 8192 then failHttp(); return end
  local headerEnd = response:find("\r\n\r\n", 1, true)
  if not headerEnd then return end
  local headers = response:sub(1, headerEnd + 3)
  local status = tonumber(headers:match("^HTTP/1%.[01] (%d%d%d)"))
  local length = tonumber(headers:lower():match("\r\ncontent%-length:%s*(%d+)"))
  if not status or not length or length > 4096 then failHttp("invalid HTTP response"); return end
  if #response < headerEnd + 3 + length then return end
  if status == 401 or status == 403 then
    closeHttp(); stopped = true
    console:error("Crystal cloud source revoked; download a new script")
    return
  end
  if status < 200 or status >= 300 then failHttp("HTTP " .. status); return end
  if not acknowledged then
    local requestId = headers:lower():match("\r\nx%-request%-id:%s*([a-f0-9-]+)")
    console:log("Crystal cloud relay accepted live state" .. (requestId and " (request " .. requestId:sub(1, 36) .. ")" or ""))
    acknowledged = true
  end
  if headers:lower():find("connection: close", 1, true) then closeHttp()
  else pending = nil; response = ""; sentIndex = 1 end
  delay = 2
end
