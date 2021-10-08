function runCommand (container, cmd, workDir, callback) {
  workDir = workDir || '/usr/src/twodayslate'
  container.exec({ Cmd: cmd, AttachStdin: true, AttachStdout: true, AttachStderr: true, WorkingDir: workDir }, function (err, exec) {
    if (err) { console.log(err); return callback(err) }
    exec.start({}, function (err, stream) {
      if (err) { console.log(err); return callback(err) }
      let nextDataType = null
      let nextDataLength = null
      let buffer = Buffer.from('')
      let finished = false

      let stdoutContent = ''
      let stderrContent = ''

      function processData (data) {
        if (data) {
          buffer = Buffer.concat([buffer, data])
        }
        if (!nextDataType) {
          if (buffer.length >= 8) {
            const header = bufferSlice(8)
            nextDataType = header.readUInt8(0)
            nextDataLength = header.readUInt32BE(4)
            // It's possible we got a "data" that contains multiple messages
            // Process the next one
            processData()
          }
        } else {
          if (buffer.length >= nextDataLength) {
            const content = bufferSlice(nextDataLength)
            if (nextDataType === 1) {
              stdoutContent += content
              // process.stdout.write(content);
            } else {
              stderrContent += content
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
        const out = buffer.slice(0, end)
        buffer = Buffer.from(buffer.slice(end, buffer.length))
        return out
      }

      function didClose () {
        if (!finished) {
          exec.inspect(function (err, data) {
            callback(err, stdoutContent, stderrContent, data)
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
        callback(err, stdoutContent, stderrContent)
      }

      stream.on('data', processData)
      stream.on('close', didClose)
      stream.on('end', didClose)
      stream.on('error', onStreamError)
    })
  })
}

module.exports = {
  runCommand: runCommand,
  asyncRunCommand: async function (container, cmd, workDir) {
    return new Promise(function (resolve, reject) {
      runCommand(container, cmd, workDir, function (err, stdout, stderr, data) {
        if (err) {
          reject(err, stdout, stderr)
        } else {
          resolve({ stdout, stderr, data })
        }
      })
    })
  }
}
