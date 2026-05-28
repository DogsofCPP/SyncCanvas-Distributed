# WebSocket Test Script
$token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidXNlci1kMGIxOWVlNWQwMGQiLCJ1c2VybmFtZSI6ImJlbmNoXzdiZmM0ZTJkIiwiaWF0IjoxNzc5ODUzMDcxLCJleHAiOjE3ODA0NTc4NzF9.9NxjcxwLAwUQlzKrRIEegGJvs7SocLNYIF3PX9qiu4A"
$canvasId = "test-canvas-" + (Get-Date -Format "yyyyMMddHHmmss")
$wsUrl = "ws://localhost:3000/ws?canvas_id=$canvasId&token=$token"

Write-Host "Testing WebSocket connection to: $wsUrl"
Write-Host "Token: $($token.Substring(0,50))..."

# Note: PowerShell 7+ has built-in WebSocket support
# For PowerShell 5.x, this would need a .NET implementation
try {
    $ws = New-Object System.Net.WebSockets.ClientWebSocket
    $ct = [Threading.CancellationToken]::None
    $task = $ws.ConnectAsync($wsUrl, $ct)
    $task.Wait(5000)
    
    if ($ws.State -eq 'Open') {
        Write-Host "[OK] WebSocket connected successfully!"
        
        # Send a test element_add message
        $testMsg = @{
            action = "element_add"
            canvas_id = $canvasId
            element_id = [guid]::NewGuid().ToString()
            kind = "rect"
            data = @{
                x1 = 100
                y1 = 100
                x2 = 200
                y2 = 200
            }
            style = @{
                stroke = "#000000"
                fill = "none"
                stroke_width = 2
            }
            timestamp = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
        } | ConvertTo-Json -Compress
        
        Write-Host "Sending test message: $testMsg"
        
        $msgBytes = [Text.Encoding]::UTF8.GetBytes($testMsg)
        $sendTask = $ws.SendAsync([ArraySegment[byte]]$msgBytes, 'Text', $true, $ct)
        $sendTask.Wait(2000)
        
        Write-Host "[OK] Message sent"
        
        Start-Sleep -Seconds 2
        
        $closeTask = $ws.CloseAsync('NormalClosure', "Test complete", $ct)
        $closeTask.Wait(2000)
        
        Write-Host "[OK] WebSocket closed"
    } else {
        Write-Host "[ERROR] WebSocket state: $($ws.State)"
    }
} catch {
    Write-Host "[ERROR] $($_.Exception.Message)"
}
