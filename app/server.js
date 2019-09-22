'use strict';
process.chdir(__dirname);

var onvif = null;
try {
	onvif = require('../lib/node-onvif.js');
} catch(e) {
	onvif = require('node-onvif');
}
var WebSocketServer = require('websocket').server;
var http = require('http');
var fs = require('fs');
var mic = require('mic');
var wav = require('wav');
var Gpio = require("onoff").Gpio;
var port = 8180;
var micInstance = null;
var micInstanceStatus = 'stop';
var micInstanceForRec = null;
var recStatus = 'stop';
var micInputStream = null;
var micInputStreamForRec = null;

// ptz константы

// ### GPIO ###
const leftPin = new Gpio(17, "out");
const rightPin = new Gpio(18, "out");
const upPin = new Gpio(27, "out");
const downPin = new Gpio(22, "out");
const minSpeed = new Gpio(23, "out");
const maxSpeed = new Gpio(24, "out");

// ### Мои значения ###
const minusMin = -1.0;
const plusMin = 1.0;
const minusMax = -2.0;
const plusMax = 2.0;

/**
 * пользовательские настройки
 */
var settingPath = "files/settings.json";

(function main() {
	var http_server = http.createServer(httpServerRequest);
	http_server.listen(port, function() {
		console.log("Listening on port " + port);
	});
	console.log(http_server);
	var wsserver = new WebSocketServer({
		httpServer: http_server,
	});
	wsserver.on('request', wsServerRequest);
})();

function httpServerRequest(req, res) {
	var path = req.url.replace(/\?.*$/, '');
	if(path.match(/\.{2,}/) || path.match(/[^a-zA-Z\d\_\-\.\/]/)) {
		httpServerResponse404(req.url, res);
		return;
	}
	if(path === '/') {
		path = 'static/index.html';
	} else if (path === '/demo') {
		getAudioDemo(res);
		return;
	}
	var fpath = './' + path;
	fs.readFile(fpath, 'utf-8', function(err, data){
		if(err) {
			httpServerResponse404(req.url, res);
			return;
		} else {
			var ctype = getContentType(fpath);
			res.writeHead(200, {'Content-Type': ctype});
			if (ctype.indexOf('image') !== -1) {
				require("fs").readFile(fpath, (err, image) => {
					res.end(image);
				});
			} else {
				res.write(data);
				res.end();
			}

			console.log('HTTP : 200 OK : ' + req.url + ' ctype : ' + ctype);
		}
	});
}

function getContentType(fpath) {
	var ext = fpath.split('.').pop().toLowerCase();
	if(ext.match(/^(html|htm)$/)) {
		return 'text/html';
	} else if(ext.match(/^(jpeg|jpg)$/)) {
		return 'image/jpeg';
	} else if(ext.match(/^(png|gif)$/)) {
		return 'image/' + ext;
	} else if(ext === 'css') {
		return 'text/css';
	} else if(ext === 'js') {
		return 'text/javascript';
	} else if(ext === 'woff2') {
		return 'application/font-woff';
	} else if(ext === 'woff') {
		return 'application/font-woff';
	} else if(ext === 'ttf') {
		return 'application/font-ttf';
	} else if(ext === 'svg') {
		return 'image/svg+xml';
	} else if(ext === 'eot') {
		return 'application/vnd.ms-fontobject';
	} else if(ext === 'oft') {
		return 'application/x-font-otf';
	} else {
		return 'application/octet-stream';
	}
}

function httpServerResponse404(url, res) {
	res.writeHead(404, {'Content-Type': 'text/plain'});
	res.write('404 Not Found: ' + url);
	res.end();
	console.log('HTTP : 404 Not Found : ' + url);
}

var client_list = [];

function wsServerRequest(request) {
	var conn = request.accept(null, request.origin);
	conn.on("message", function(message) {
		if(message.type !== 'utf8') {
			return;
		}
		var data = JSON.parse(message.utf8Data);
		var method = data['method'];
		var params = data['params'];
		console.log('Method: ' + method);
		if(method === 'startDiscovery') {
			startDiscovery(conn);
		} else if(method === 'connect') {
			if (micInstance !== null) {
				micInstance.stop();
				micInstanceStatus = "stop";
			}
			if (micInstanceForRec !== null) {
				micInstanceForRec.stop();
				recStatus = "stop";
			}
			connect(conn, params);
		} else if(method === 'fetchSnapshot') {
			fetchSnapshot(conn, params);
		} else if(method === 'ptzMove') {
			ptzMove(conn, params);
		} else if(method === 'ptzStop') {
			ptzStop(conn, params);
		} else if(method === 'ptzHome') {
			ptzHome(conn, params);
		} else if(method === 'saveSettings') {
		    saveSettings(conn, params);
        } else if(method === 'getSettings') {
		    getSettings(conn, params);
        } else if(method === 'getAudio') {
			micInstance = new mic({
				rate: '16000',
				channels: '1',
				debug: true,
				exitOnSilence: 6,
				bitwidth: 16,
			});
			micInputStream = micInstance.getAudioStream();
			micInstance.start();
			micInstanceStatus = 'started';
			getAudio(conn, params);
		} else if(method === 'recAudio') {
			recAudio(conn, params);
		} else if(method === 'gpioMove') {
			gpioMove(conn, params);
		} else if(method === 'moveStop') {
			moveStop(conn, params);
		}
	});

	conn.on("close", function(message) {

	});
	conn.on("error", function(error) {
		console.log(error);
	});
};

var devices = {};
function startDiscovery(conn) {
	devices = {};
	let names = {};
	onvif.startProbe().then((device_list) => {
		device_list.forEach((device) => {
			let odevice = new onvif.OnvifDevice({
				xaddr: device.xaddrs[0]
			});
			let addr = odevice.address;
			devices[addr] = odevice;
			names[addr] = device.name;
		});
		var devs = {};
		for(var addr in devices) {
			devs[addr] = {
				name: names[addr],
				address: addr
			}
		}
		let res = {'id': 'startDiscovery', 'result': devs};
		conn.send(JSON.stringify(res));
	}).catch((error) => {
		let res = {'id': 'connect', 'error': error.message};
		conn.send(JSON.stringify(res));
	});
}

function connect(conn, params) {
	// var device = devices[params.address];
	var device = new onvif.OnvifDevice({
		xaddr: 'http://' + params.address + ':' + params.port + '/onvif/device_service'
	});
	devices[params.address] = device;
	if(params.user) {
		device.setAuth(params.user, params.pass);
	}
	try {
		device.init((error, result) => {
			var res = {'id': 'connect'};
			if(error) {
				res['error'] = error.toString();
			} else {
				res['result'] = result;
			}
			conn.send(JSON.stringify(res));
		});
	} catch (e) {
		var res = {'id': 'connect', 'error': 'The specified device is not found: ' + params.address, 'detail': e};
		conn.send(JSON.stringify(res));
		return;
	}

}

// For Debug --------------------------------------------
//var total_size = 0;
//var start_time = 0;
//var total_frame = 0;
// ------------------------------------------------------

function fetchSnapshot(conn, params) {
	// For Debug --------------------------------------------
	//if(start_time === 0) {
	//	start_time = Date.now();
	//}
	// ------------------------------------------------------
	var device = devices[params.address];
	// var device = devices['10.255.0.242'];
	if(!device) {
		var res = {'id': 'fetchSnapshot', 'error': 'The specified device is not found: ' + params.address};
		conn.send(JSON.stringify(res));
		return;
	}
	device.fetchSnapshot((error, result) => {
		var res = {'id': 'fetchSnapshot'};
		if(error) {
			res['error'] = error.toString();
		} else {
			var ct = result['headers']['content-type'];
			var buffer = result['body'];
			var b64 = buffer.toString('base64');
			var uri = 'data:' + ct + ';base64,' + b64;
			res['result'] = uri;

			// For Debug --------------------------------------------
			/*
			total_size += parseInt(result['headers']['content-length'], 10);
			var duration = Date.now() - start_time;
			var bps = total_size * 1000 / duration;
			var kbps = parseInt(bps / 1000);
			total_frame ++;
			var fps = Math.round(total_frame * 1000 / duration);
			console.log(kbps + ' kbps / ' + fps + ' fps');
			*/
			// ------------------------------------------------------
		}
		conn.send(JSON.stringify(res));
	});
}

function ptzMove(conn, params) {
	var device = devices[params.address];
    // console.log(devices);
	// var device = devices['10.255.0.242'];
	if(!device) {
		var res = {'id': 'ptzMove', 'error': 'The specified device is not found: ' + params.address};
		conn.send(JSON.stringify(res));
		return;
	}
	device.ptzMove(params, (error) => {
		var res = {'id': 'ptzMove'};
		if(error) {
			res['error'] = error.toString();
		} else {
			res['result'] = true;
		}
		conn.send(JSON.stringify(res));
	});
}

function ptzStop(conn, params) {
	var device = devices[params.address];
	// var device = devices['10.255.0.242'];
	if(!device) {
		var res = {'id': 'ptzStop', 'error': 'The specified device is not found: ' + params.address};
		conn.send(JSON.stringify(res));
		return;
	}
	device.ptzStop((error) => {
		var res = {'id': 'ptzStop'};
		if(error) {
			res['error'] = error.toString();
		} else {
			res['result'] = true;
		}
		conn.send(JSON.stringify(res));
	});
}

function moveStop(conn, params) {
	console.log('moveStop: ');
	console.log(params.speed);
	const pinValue = 0;
	if (params.speed.x === plusMax) { // right max
		var pinNumber = rightPin;
		var pinSpeed = maxSpeed; //max
	} else if (params.speed.x === plusMin) { // right min
		pinNumber = rightPin;
		pinSpeed = minSpeed;
	} else if (params.speed.x === minusMax) { // left max
		pinNumber = leftPin;
		pinSpeed = maxSpeed;
	} else if (params.speed.x === minusMin) { // left min
		pinNumber = leftPin;
		pinSpeed = minSpeed;
	} else if (params.speed.y === plusMax) { // up max
		pinNumber = upPin;
		pinSpeed = maxSpeed;
	} else if (params.speed.y === plusMin) { // up min
		pinNumber = upPin;
		pinSpeed = minSpeed;
	} else if (params.speed.y === minusMax) { // down max
		pinNumber = downPin;
		pinSpeed = maxSpeed;
	} else if (params.speed.y === minusMin) { // down min
	    pinNumber = downPin;
	    pinSpeed = minSpeed;
    } else {
	    pinNumber = false;
	    pinSpeed = false;
    }

	if (pinNumber && pinSpeed) {
		pinSpeed.read(function (err, val) {
			console.log(val);
			if(val === 1) {
				pinSpeed.write(pinValue, function (err) {
					pinNumber.writeSync(pinValue);
					console.log('stop pin');
				});
				console.log('stop speed');
			}
		});
	}
}

function gpioMove(conn, params) {
	console.log('gpioMove: ');
	console.log(params.speed);
	const pinValue = 1;
	var out = "output";
	if (params.speed.x === plusMax) { // right max
        var pinNumber = rightPin;
        var pinSpeed = maxSpeed; //max
    } else if (params.speed.x === plusMin) { // right min
        pinNumber = rightPin;
        pinSpeed = minSpeed;
    } else if (params.speed.x === minusMax) { // left max
        pinNumber = leftPin;
        pinSpeed = maxSpeed;
    } else if (params.speed.x === minusMin) { // left min
        pinNumber = leftPin;
        pinSpeed = minSpeed;
    } else if (params.speed.y === plusMax) { // up max
        pinNumber = upPin;
        pinSpeed = maxSpeed;
    } else if (params.speed.y === plusMin) { // up min
        pinNumber = upPin;
        pinSpeed = minSpeed;
    } else if (params.speed.y === minusMax) { // down max
        pinNumber = downPin;
        pinSpeed = maxSpeed;
    } else if (params.speed.y === minusMin) { // down min
        pinNumber = downPin;
        pinSpeed = minSpeed;
    } else {
        pinNumber = false;
        pinSpeed = false;
    }

    if (pinNumber && pinSpeed) {
    	pinSpeed.read(function (err, val) {
    		console.log(val);
			if(val === 0) {
				pinSpeed.write(pinValue, function (err) {
					pinNumber.writeSync(pinValue);
				});
				console.log('ok');
			}
		});
	}
}

function ptzHome(conn, params) {
	var device = devices[params.address];
	if(!device) {
		var res = {'id': 'ptzMove', 'error': 'The specified device is not found: ' + params.address};
		conn.send(JSON.stringify(res));
		return;
	}
	if(!device.services.ptz) {
		var res = {'id': 'ptzHome', 'error': 'The specified device does not support PTZ.'};
		conn.send(JSON.stringify(res));
		return;
	}

	var ptz = device.services.ptz;
	var profile = device.getCurrentProfile();
	var params = {
		'ProfileToken': profile['token'],
		'Speed'       : 1
	};
	ptz.gotoHomePosition(params, (error, result) => {
		var res = {'id': 'ptzMove'};
		if(error) {
			res['error'] = error.toString();
		} else {
			res['result'] = true;
		}
		conn.send(JSON.stringify(res));
	});
}

function saveSettings(conn, params) {
    fs.writeFile(settingPath, JSON.stringify(params.settings), function (err) {
        if (err) {
            var res = {'id': 'saveSettings', 'result': 'error', 'detail': err};
        } else {
            res = {'id': 'saveSettings', 'result': 'ok', 'detail': 'File saved'};
        }
        conn.send(JSON.stringify(res));
    });
}

function getSettings(conn, params) {
    fs.readFile(settingPath, 'utf8', function (error, data) {
        if (error) {
            var res = {'id': 'getSettings', 'result': 'error', 'detail': error};
        } else {
			res = {'id': 'getSettings', 'result': 'ok', 'detail': data};
		}
        console.log(JSON.stringify(res));
        conn.send(JSON.stringify(res));
        //TODO сохранить настройки в переменную. И вообще поработать на системой write/read для настроек.пше ыефгt s
    });
}

function getAudio(conn, params) {
	micInputStream.on('data', (chunk) => {
		conn.sendBytes(chunk);
	});
}

function recAudio(conn, params) {
	var date = new Date();
	var fileName = 'Record_'
		+ date.getDate() + '-'
		+ date.getMonth() + '-'
		+ date.getFullYear() + '_'
		+ date.getHours() + '-'
		+ date.getMinutes();
	if (params.action === 'startRec') {
		if (recStatus === 'stop') {
			micInstanceForRec = new mic({
				rate: '16000',
				channels: '1',
				debug: true,
				exitOnSilence: 6
			});
			micInstanceForRec.start();
			recStatus = 'started';
			micInputStreamForRec = micInstanceForRec.getAudioStream();
		}
		var outputFileStream = new wav.FileWriter('files/records/' + fileName + '.wav', {
			"channels": 1,
			"sampleRate": 16000,
			"bitDepth": 32
		});
		micInputStreamForRec.pipe(outputFileStream);
	} else if (params.action === 'pauseRec') {
		if (recStatus === 'started') {
			micInstanceForRec.pause();
			recStatus = 'pause';
		}
	} else if (params.action === 'resumeRec') {
		if (recStatus === 'pause') {
			micInstanceForRec.resume();
			recStatus = 'started';
		}
	} else if (params.action === 'stopRec') {
		if (recStatus === 'pause' || recStatus === 'started') {
			micInstanceForRec.stop();
			recStatus = 'stop';
		}
	}
	var response = JSON.stringify({'id': 'recAudio', 'status': recStatus});
	conn.send(response);
}

function getAudioDemo(response) {
	micInstance = new mic({
		rate: '16000',
		channels: '1',
		debug: true,
		exitOnSilence: 6
	});
	micInstance.start();
	micInputStream = micInstance.getAudioStream();
	var writer = new wav.Writer({
		"channels": 1,
		"sampleRate": 16000,
		"bitDepth": 32
	});
	var ctype = 'audio/vnd.wave';
	console.log(writer._header);
	// response.setHeader("Content-Type", ctype);
	response.writeHead(200, {'Content-Type': ctype});
	response.write(writer._header);
	response.end();

}