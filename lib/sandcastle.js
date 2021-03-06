var _ = require('underscore'),
  Script = require('./script').Script,
  path = require('path'),
  fs = require('fs'),
  spawn = require( 'child_process' ).spawn;

function SandCastle(opts) {
  var _this = this;

  _.extend(this, {
    client: null,
    api: null,
    timeout: 5000,
    sandbox: null,
    lastHeartbeat: (new Date()).getTime(),
    socket: '/tmp/sandcastle.sock',
    useStrictMode: true,
    memoryLimitMB: 0,
    cwd: process.cwd(),
    spawnExecPath: process.execPath,
    refreshTimeoutOnTask: true,
    heartbeatScript: null,
    heartbeatId: null
  }, opts);

  if (this.api) {
    if (this.api.indexOf('.') === 0) {
      this.api = path.join(this.cwd, this.api);
    }
    this.sourceAPI = fs.readFileSync(this.api).toString();
  }

  this.spawnSandbox();
  this.startHeartbeat();

  // Shutdown the sandbox subprocess.
  // when the sandcastle process is terminated.
  process.on('exit', function() {
    _this.sandbox.kill('SIGHUP');
  });
}

SandCastle.prototype.sandboxReady = function(callback) {
  var _this = this;
  if (this.sandboxInitialized) {
    callback();
  } else {
    setTimeout(function() {
      _this.sandboxReady(callback);
    }, 500);
  }
};

SandCastle.prototype.kickOverSandCastle = function() {
  if(this.heartbeatScript) {
    this.heartbeatScript.removeAllListeners("exit");
  }
  if(this.sandboxInitialized) {
    this.sandboxInitialized = false;
    this.sandbox.kill('SIGHUP');
  }
};

SandCastle.prototype.spawnSandbox = function() {

  var _this = this;

  // attempt to unlink the old socket.
  try {fs.unlinkSync(this.socket)} catch (e) {};

  this.sandbox = spawn(this.spawnExecPath, [
    "--expose-gc",
    _this.useStrictMode ? "--use_strict" : "--nouse_strict",
    "--max_old_space_size=" + _this.memoryLimitMB.toString(),
    __dirname + '/../bin/sandcastle.js',
    'sandbox',
    '--socket=' + this.socket
  ], {cwd: _this.cwd});

  // Assume that the sandbox is created once
  // data is emitted on stdout.
  this.sandbox.stdout.on('data', function(data) {
    _this.waitingOnHeartbeat = false; // Used to keep only one heartbeat on the wire at a time.
    _this.sandboxInitialized = true;
  });

  this.sandbox.stderr.on('data', function(data) {
    _this.waitingOnHeartbeat = false;
  });

  this.sandbox.on('exit', function (code) {
    _this.spawnSandbox();
  });

};

SandCastle.prototype.kill = function() {
  clearInterval(this.heartbeatId);
  this.sandbox.removeAllListeners('exit');
  this.sandbox.kill('SIGHUP');
  process.removeAllListeners('exit');
};

SandCastle.prototype.startHeartbeat = function() {

  this.heartbeatId = setInterval(function(sc) {
    var now = Date.now();

    sc.runHeartbeatScript();

    if ( (now - sc.lastHeartbeat) > sc.timeout) {
      sc.lastHeartbeat = Date.now();
      sc.kickOverSandCastle();
    }
  }, 1000, this);
};

SandCastle.prototype.runHeartbeatScript = function() {

  // Only wait for one heartbeat script
  // to execute at a time.
  if (this.waitingOnHeartbeat) return;
  this.waitingOnHeartbeat = true;

  var _this = this;

  if (this.heartbeatScript) {
    this.heartbeatScript.removeAllListeners('exit');
    //this.heartbeatScript.setSandCastle(null);
    this.heartbeatScript = null;
  }

  this.heartbeatScript = this.createScript("exports.main = function() {exit(true)}");

  this.heartbeatScript.once("exit", function (err, output) {

    //if (_this.heartbeatScript) _this.heartbeatScript.setSandCastle(null);
    //_this.heartbeatScript = null;

    if (output) {

      _this.lastHeartbeat = Date.now();
      _this.waitingOnHeartbeat = false;
    }

  });

  this.heartbeatScript.run('main');
};

SandCastle.prototype.createScript = function(source, opts) {
  var sourceAPI = this.sourceAPI || '';

  if (opts && opts.extraAPI) sourceAPI += ";\n" + opts.extraAPI;

  return new Script({
    source: source,
    sourceAPI: sourceAPI,
    timeout: this.timeout,
    socket: this.socket,
    sandcastle: this
  });
};

SandCastle.prototype.isInitialized = function() {
  return this.sandboxInitialized;
}

SandCastle.prototype.getSocket = function() {
  return this.socket;
}

exports.SandCastle = SandCastle;
