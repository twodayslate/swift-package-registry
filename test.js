var Docker = require('dockerode');
var docker = new Docker({socketPath: '/var/run/docker.sock'});
var fs = require('fs');
const process = require('process');

var github = require('octonode');
var client = github.client();
var ghrepo = client.repo('twodayslate/AddressURL');

function runCommand(container, cmd, workDir, callback) {
    workDir = workDir || "/usr/src/twodayslate"
    container.exec({Cmd: cmd, AttachStdin: true, AttachStdout: true, AttachStderr: true, WorkingDir: workDir}, function(err, exec) {
        if(err) { console.log(err); return callback(err);}
        exec.start({}, function(err, stream) {
            if(err) { console.log(err); return callback(err); }
            var nextDataType = null;
            var nextDataLength = null;
            var buffer = Buffer.from('');
            var finished = false;

            var stdout_content = "";
            var stderr_content = "";


            function processData(data) {
                if (data) {
                    buffer = Buffer.concat([buffer, data]);
                }
                if (!nextDataType) {
                    if (buffer.length >= 8) {
                        var header = bufferSlice(8);
                        nextDataType = header.readUInt8(0);
                        nextDataLength = header.readUInt32BE(4);
                        // It's possible we got a "data" that contains multiple messages
                        // Process the next one
                        processData();
                    }
                } else {
                    if (buffer.length >= nextDataLength) {
                        var content = bufferSlice(nextDataLength);
                        if (nextDataType === 1) {
                            stdout_content += content;
                            //process.stdout.write(content);
                        } else {
                            stderr_content += content;
                            //process.stderr.write(content);
                        }
                        nextDataType = null;
                        // It's possible we got a "data" that contains multiple messages
                        // Process the next one
                        processData();
                    }
                }
            }

            function bufferSlice(end) {
                var out = buffer.slice(0, end);
                buffer = Buffer.from(buffer.slice(end, buffer.length));
                return out;
            }

            function didClose() {
                if (!finished) {
                    exec.inspect(function(err, data) {
                        callback(err, stdout_content, stderr_content, data);
                    });
                }
                finished = true;
            }
            function onStreamError(err) {
                console.log("did get an error");
                finished = true;
                stream.removeListener('data', processData);
                stream.removeListener('error', onStreamError);
                stream.removeListener('close', didClose);
                stream.removeListener('end', didClose);
                callback(err, stdout_content, stderr_content);
            }

            stream.on('data', processData);
            stream.on('close', didClose);
            stream.on('end', didClose);
            stream.on('error', onStreamError);
        });
    });
}

function parsePackage(ghrepo, swift_version, callback) {
    swift_version = swift_version || "latest"
    console.log("going to try", swift_version)
    ghrepo.info(function(err, repo_info) {
        if(err) { console.log(err); return callback(err, ghrepo); }
        console.log("info", repo_info);
        ghrepo.releases(function(err, repo_releases) {
            if(err) { console.log(err); return callback(err, ghrepo); }
            console.log("releases", repo_releases[0]);
            docker.pull('swift:'+swift_version, function (err, stream) {
                if(err) {
                    console.log(err);
                    return callback(err, ghrepo)
                }
                 docker.createContainer({Image: 'swift:'+swift_version, Cmd: ['/bin/bash'], AutoRemove: true, Tty: true,}, function (err, container) {
                    if(err) { console.log(err); return callback(err, ghrepo); }
                    container.start(function (err) {
                        if(err) { console.log(err); return callback(err, ghrepo); }
                        runCommand(container, ['git', 'clone', '--branch', repo_releases[0].tag_name, repo_info.clone_url, repo_info.name], "/", function(err, stdout, stderr, inspect_data) {
                            if(err) { console.log(err); return callback(err, ghrepo); }
                            if(inspect_data.ExitCode != 0) { console.log("exit code not zero", stdout, stderr, inspect_data); return callback(err, ghrepo);; }
                            console.log(stdout, stderr);
                            runCommand(container, ['cat', 'README.md'], '/' + repo_info.name, function(err, stdout, stderr, inspect_data) {
                                if(err) { console.log(err); return callback(err, ghrepo); }
                                //if(inspect_data.ExitCode != 0) { console.log("exit code not zero", stdout, stderr, inspect_data); return callback(err, ghrepo);; }
                                //console.log(stdout);

                                var url = new URL(repo_info.html_url)
                                url.hostname = "raw.githubusercontent.com"
                                url.pathname = url.pathname + "/" + repo_releases[0].tag_name
                                var marked = require('marked');
                                marked.setOptions({
                                    baseUrl: url,
                                    renderer: new marked.Renderer(),
                                    highlight: function(code, language) {
                                        const hljs = require('highlight.js');
                                        const validLanguage = hljs.getLanguage(language) ? language : 'plaintext';
                                        return hljs.highlight(validLanguage, code).value;
                                      },
                                      gfm: true,
                                      breaks: true,
                                });

                                var readme = marked(stdout);

                                runCommand(container, ['swift', 'package', 'tools-version'], "/" + repo_info.name, function(err, stdout, stderr, inspect_data) {
                                    if(err) { console.log(err); return callback(err, ghrepo, readme); }
                                    if(inspect_data.ExitCode != 0) { console.log("exit code not zero", stdout, stderr, inspect_data); return callback(err, ghrepo, readme);; }
                                    var tool_version = stdout.trim();
                                    console.log(tool_version);
                                    runCommand(container, ['swift', 'package', 'describe'], "/" + repo_info.name, function(err, stdout, stderr, inspect_data) {
                                        if(err) { console.log(err); return callback(err, ghrepo, readme, tool_version); }
                                        if(inspect_data.ExitCode != 0) { console.log("exit code not zero", stdout, stderr, inspect_data); return callback(err, ghrepo, readme, tool_version);; }
                                        console.log(stdout);
                                        var description = stdout;
                                        runCommand(container, ['swift', 'package', 'show-dependencies'], "/" + repo_info.name, function(err, stdout, stderr, inspect_data) {
                                            if(err) { console.log(err); return callback(err, ghrepo, readme, tool_version, description); }
                                            if(inspect_data.ExitCode != 0) { console.log("exit code not zero", stdout, stderr, inspect_data); return callback(err, ghrepo, readme, tool_version, description);; }
                                            console.log(stdout);
                                            container.stop(function (err, data) {
                                                container.remove(function (err, data) {
                                                    console.log("done :)")
                                                    return callback(null, ghrepo, readme, tool_version, description, stdout);
                                                });
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
}

var versions = ["latest", "5.1", "5.0", "4.2", "4.1", "4.0", "3.1"];
var index = 0;

function cb(err, repo, readme, tool_version, description, dependencies) {
    if(err) { 
        console.log(err);
        index = index +1;
        if (index < versions.length) {
            parsePackage(ghrepo, versions[index], cb);
        }
        return
    }
    console.log(readme);
    console.log(tool_version);
    console.log(description);
    console.log(dependencies);
}

parsePackage(ghrepo, versions[index], cb);

