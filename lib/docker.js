module.exports = {
  runCommand: function (container, cmd, workDir, callback) {
    workDir = workDir || '/usr/src/twodayslate'
    container.exec({ Cmd: cmd, AttachStdin: true, AttachStdout: true, AttachStderr: true, WorkingDir: workDir }, function (err, exec) {
      if (err) { console.log(err); return callback(err) }
      exec.start({}, function (err, stream) {
        if (err) { console.log(err); return callback(err) }
        var nextDataType = null
        var nextDataLength = null
        var buffer = Buffer.from('')
        var finished = false

        var stdout_content = ''
        var stderr_content = ''

        function processData (data) {
          if (data) {
            buffer = Buffer.concat([buffer, data])
          }
          if (!nextDataType) {
            if (buffer.length >= 8) {
              var header = bufferSlice(8)
              nextDataType = header.readUInt8(0)
              nextDataLength = header.readUInt32BE(4)
              // It's possible we got a "data" that contains multiple messages
              // Process the next one
              processData()
            }
          } else {
            if (buffer.length >= nextDataLength) {
              var content = bufferSlice(nextDataLength)
              if (nextDataType === 1) {
                stdout_content += content
                // process.stdout.write(content);
              } else {
                stderr_content += content
                // process.stderr.write(content);
              }
              nextDataType = null
              // It's possible we got a "data" that contains multiple messages
              // Process the next one
              processData()
            }
          }
        }

        function bufferSlice (end) {
          var out = buffer.slice(0, end)
          buffer = Buffer.from(buffer.slice(end, buffer.length))
          return out
        }

        function didClose () {
          if (!finished) {
            exec.inspect(function (err, data) {
              callback(err, stdout_content, stderr_content, data)
            })
          }
          finished = true
        }
        function onStreamError (err) {
          console.log('did get an error')
          finished = true
          stream.removeListener('data', processData)
          stream.removeListener('error', onStreamError)
          stream.removeListener('close', didClose)
          stream.removeListener('end', didClose)
          callback(err, stdout_content, stderr_content)
        }

        stream.on('data', processData)
        stream.on('close', didClose)
        stream.on('end', didClose)
        stream.on('error', onStreamError)
      })
    })
  }
}
