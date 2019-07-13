(function() {

$(document).ready(function() {
	(new OnvifManager()).init();
});

/*-------------------------------------------------------------------
* Constructor
* ---------------------------------------------------------------- */
function OnvifManager() {
	this.ws = null; // WebSocket object
	this.el = { // jQuery objects for the HTML elements
		'frm_con' : $('#connect-form'),
		'sel_dev' : $('#connect-form input[name="device"]'),
		'sel_port' : $('#connect-form input[name="port"]'),
		'inp_usr' : $('#connect-form input[name="user"]'),
		'inp_pas' : $('#connect-form input[name="pass"]'),
		'btn_con' : $('#connect-form button[name="connect"]'),
		'div_pnl' : $('#connected-device'),
		'img_snp' : $('#connected-device img.snapshot'),
		'img_scope' : $('#connected-device img.scope'),
		'btn_dcn' : $('#connected-device button[name="disconnect"]'),
		'mdl_msg' : $('#message-modal'),
		'ptz_spd' : $('input[name="ptz-speed"]'),
		'btn_hme' : $('#connected-device div.ptz-pad-box button.ptz-goto-home'),
		'ptz_pad' : $('#connected-device div.ptz-pad-box'),
		'zom_in'  : $('#connected-device div.ptz-zom-ctl-box button.ptz-zom-in'),
		'zom_out' : $('#connected-device div.ptz-zom-ctl-box button.ptz-zom-ot'),
		'save_prtsc': $('#connected-device button[name="prtsc"]'),
		'settings': $('#connected-device button[name="settings"]'),
		'mdl_settings': $('#settings-modal'),
		'settings_form': $('#settings-form'),
		'call_settings': $('.call-settings'),
		'mic_audio': $('#connected-device div.audio-box button[name="mic"]'),
		'rec_audio': $('#connected-device div.rec-box button[name="rec"]'),
		'pause_audio': $('#connected-device div.pause-box button[name="pause"]'),
	};
	this.selected_address = '';
	this.device_connected = false;
	this.ptz_moving = false;
	this.snapshot_w = 400;
	this.snapshot_h = 300;
	this.user_settings = null;
	this.get_settings_def = $.Deferred(); //ждем пока придут настройки
	this.audio_context = new AudioContext();
	this.audio_source = this.audio_context.createBufferSource();
	this.audio = new Audio();
}

OnvifManager.prototype.init = function() {
	this.initWebSocketConnection();
	$(window).on('resize', this.adjustSize.bind(this));
	console.log(this.el['mic_audio']);
	self = this;
	this.el['mic_audio'].on('click', function () {
		self.getAudio();
	});
	// this.el['btn_con'].on('click', this.pressedConnectButton.bind(this));
	// this.el['btn_dcn'].on('click', this.pressedConnectButton.bind(this));
	$(document.body).on('keydown', this.ptzMove.bind(this));
	$(document.body).on('keydown', this.callSettingsFocus.bind(this));
	$(document.body).on('keyup', this.ptzStop.bind(this));
	this.el['btn_hme'].on('click', this.ptzGotoHome.bind(this));
	this.el['btn_hme'].on('touchstart', this.ptzGotoHome.bind(this));
	this.el['btn_hme'].on('touchend', this.ptzGotoHome.bind(this));
	this.el['ptz_pad'].on('mousedown', this.ptzMove.bind(this));
	this.el['ptz_pad'].on('mouseup', this.ptzStop.bind(this)	);
	this.el['ptz_pad'].on('touchstart', this.ptzMove.bind(this));
	this.el['ptz_pad'].on('touchend', this.ptzStop.bind(this));
	this.el['zom_in'].on('mousedown', this.ptzMove.bind(this));
	this.el['zom_in'].on('mouseup', this.ptzStop.bind(this));
	this.el['zom_in'].on('touchstart', this.ptzMove.bind(this));
	this.el['zom_in'].on('touchend', this.ptzStop.bind(this));
	this.el['zom_out'].on('mousedown', this.ptzMove.bind(this));
	this.el['zom_out'].on('mouseup', this.ptzStop.bind(this));
	this.el['zom_out'].on('touchstart', this.ptzMove.bind(this));
	this.el['zom_out'].on('touchend', this.ptzStop.bind(this));
	$(document.body).on('keydown', this.saveScreenshot.bind(this));
	this.el['save_prtsc'].on('click', this.saveScreenshot.bind(this));
	this.el['settings'].on('click', this.openSettings.bind(this));
	this.el['settings_form'].on('submit', this.saveSettins.bind(this));
	this.el['call_settings'].on('input', this.callSettings.bind(this));
	this.el['rec_audio'].on('click', this.recAudio.bind(this));
	this.el['pause_audio'].on('click', this.pauseRec.bind(this));
};

OnvifManager.prototype.adjustSize = function() {
	var div_dom_el = this.el['div_pnl'].get(0);
	var rect = div_dom_el.getBoundingClientRect() ;
	var x = rect.left + window.pageXOffset;
	var y = rect.top + window.pageYOffset;
	var w = rect.width;
	var h = window.innerHeight - y - 5;
	div_dom_el.style.height = h + 'px';
	var aspect_ratio = w / h;
	var snapshot_aspect_ratio = this.snapshot_w / this.snapshot_h;
	var img_dom_el = this.el['img_snp'].get(0);
	var scope_dom_el = this.el['img_scope'].get(0);
	var dom_elements = [];

	dom_elements.push(img_dom_el, scope_dom_el);

	// if(snapshot_aspect_ratio > aspect_ratio) {
	// 	img_w = w;
	// 	img_h = (w / snapshot_aspect_ratio);
	// 	img_dom_el.style.width = img_w + 'px';
	// 	img_dom_el.style.height = img_h + 'px';
	// 	img_dom_el.style.left = '0px';
	// 	img_dom_el.style.top = ((h - img_h) / 2) + 'px';
	// } else {
	// 	img_h = h;
	// 	img_w = (h * snapshot_aspect_ratio);
	// 	img_dom_el.style.height = img_h + 'px';
	// 	img_dom_el.style.width = img_w + 'px';
	// 	img_dom_el.style.left = ((w - img_w) / 2) + 'px';
	// 	img_dom_el.style.top = '0px';
	// }

	if(snapshot_aspect_ratio > aspect_ratio) {
		img_w = w;
		img_h = (w / snapshot_aspect_ratio);
		dom_elements.forEach(img_dom_el => {
			img_dom_el.style.width = img_w + 'px';
			img_dom_el.style.height = img_h + 'px';
			img_dom_el.style.left = '0px';
			img_dom_el.style.top = ((h - img_h) / 2) + 'px';
		});
	} else {
		img_h = h;
		img_w = (h * snapshot_aspect_ratio);
		dom_elements.forEach(img_dom_el => {
			img_dom_el.style.height = img_h + 'px';
			if (img_dom_el === scope_dom_el) {
				img_dom_el.style.width = img_h + 'px';
				img_dom_el.style.left = ((w - img_h) / 2) + 'px';
			} else {
				img_dom_el.style.width = img_w + 'px';
				img_dom_el.style.left = ((w - img_w) / 2) + 'px';
			}
			img_dom_el.style.top = '0px';
		});
	}
};

OnvifManager.prototype.initWebSocketConnection = function() {
	this.ws = new WebSocket('ws://' + document.location.host);
	this.ws.onopen = function() {
		console.log('WebSocket connection established.');
		// this.sendRequest('startDiscovery');
		this.getSettings();
		// this.getAudio();
		var self = this;
		this.get_settings_def.then(function () {
			self.pressedConnectButton(self);
		});
	}.bind(this);
	this.ws.onclose = function(event) {
		console.log('WebSocket connection closed.');
		this.showMessageModal('Error', 'The WebSocket connection was closed. Check if the server.js is running.');
	}.bind(this);
	this.ws.onerror = function(error) {
		this.showMessageModal('Error', 'Failed to establish a WebSocket connection. Check if the server.js is running.');
	}.bind(this);
	this.ws.onmessage = function(res) {
		try{
			var data = JSON.parse(res.data);
			var id = data.id;
			if(id === 'startDiscovery') {
				this.startDiscoveryCallback(data);
			} else if(id === 'connect') {

				this.connectCallback(data);
			} else if(id === 'fetchSnapshot') {
				this.fetchSnapshotCallback(data);
			} else if(id === 'ptzMove') {
				this.ptzMoveCallback(data);
			} else if(id === 'ptzStop') {
				this.ptzStopCallback(data);
			} else if(id === 'ptzHome') {
				this.ptzHomeCallback(data);
			} else if(id === 'saveSettings'){
				this.saveSettinsCallback(data);
			} else if(id === 'getSettings'){
				this.getSettingsCallback(data);
			} else if(id === 'getAudio') {
				this.getAudioCallback(data);
			} else if(id === 'recAudio'){
				this.recAudioCallback(data);
			}
		} catch (e) {
			this.getAudioCallback(res);
		}

	}.bind(this);
};

OnvifManager.prototype.sendRequest = function(method, params) {
	this.ws.send(JSON.stringify({
		'method': method,
		'params': params
	}));
};

OnvifManager.prototype.pressedConnectButton = function(event) {
	if(this.device_connected === true) {
		this.disconnectDevice();
	} else {
		this.connectDevice();
	}
};

OnvifManager.prototype.disconnectDevice = function() {
	this.el['img_snp'].removeAttr('src');
	this.el['div_pnl'].hide();
	this.el['frm_con'].show();
	this.device_connected = false;
	this.disabledLoginForm(false);
	this.el['btn_con'].text('Connect');
};

OnvifManager.prototype.connectDevice = function() {
	console.log(this.user_settings);
	console.log('connect');
	this.disabledLoginForm(true);
	this.el['btn_con'].text('Connecting...');
	this.sendRequest('connect', {
		'address': this.user_settings.device,
		'port'	 : this.user_settings.port,
		'user'   : this.el['inp_usr'].val(),
		'pass'   : this.el['inp_pas'].val()
	});
};

OnvifManager.prototype.disabledLoginForm = function(disabled) {
	this.el['sel_dev'].prop('disabled', disabled);
	this.el['inp_usr'].prop('disabled', disabled);
	this.el['inp_pas'].prop('disabled', disabled);
	this.el['btn_con'].prop('disabled', disabled);
};

OnvifManager.prototype.startDiscoveryCallback = function(data) {
	var devices = data.result;
	this.el['sel_dev'].empty();
	this.el['sel_dev'].append($('<option>Select a device</option>'));
	var n = 0;
	for(var key in devices) {
		var device = devices[key];
		var option_el = $('<option></option>');
		option_el.val(device.address);
		option_el.text(device.name + ' (' + device.address + ')');
		this.el['sel_dev'].append(option_el);
		n ++;
	}
	if(n === 0) {
		this.showMessageModal('Error', 'No device was found. Reload this page to discover ONVIF devices again.')
	} else {
		this.disabledLoginForm(false);
	}
};

OnvifManager.prototype.connectCallback = function(data) {
	this.el['btn_con'].prop('disabled', false);
	if(data.result) {
		this.selected_address = this.el['sel_dev'].val().split(':')[0];
		this.showConnectedDeviceInfo(this.selected_address, data.result);
		this.el['btn_con'].text('Disconnect');
		this.el['frm_con'].hide();
		this.el['div_pnl'].show();
		this.device_connected = true;
	} else if(data.error) {
		this.el['div_pnl'].hide();
		this.el['sel_dev'].prop('disabled', false);
		this.el['inp_usr'].prop('disabled', false);
		this.el['inp_pas'].prop('disabled', false);
		this.el['btn_con'].text('Connect');
		this.el['frm_con'].show();
		this.showMessageModal('Error', 'Failed to connect to the device.' + data.error.toString());
		this.device_connected = false;
	}
};

OnvifManager.prototype.showMessageModal = function(title, message) {
	this.el['mdl_msg'].find('.modal-title').text(title);
	this.el['mdl_msg'].find('.modal-message').text(message);
	this.el['mdl_msg'].modal('show');
};

OnvifManager.prototype.showSettingsModal = function() {
	this.el['settings_form'].find('input#device').val(this.user_settings.device);
	this.el['settings_form'].find('input#port').val(this.user_settings.port);
	this.el['mdl_settings'].modal('show');
};

OnvifManager.prototype.showConnectedDeviceInfo = function(address, data) {
	this.el['div_pnl'].find('span.name').text(data['Manufacturer'] + ' ' + data['Model']);
	this.el['div_pnl'].find('span.address').text(address);
	this.fetchSnapshot();
};

OnvifManager.prototype.fetchSnapshot = function() {
	this.sendRequest('fetchSnapshot', {
		'address': this.selected_address
	});
};

OnvifManager.prototype.getAudio = function () {
	this.sendRequest('getAudio');
};

OnvifManager.prototype.fetchSnapshotCallback = function(data) {
	if(data.result) {
		this.el['img_snp'].attr('src', data.result);
		window.setTimeout(function() {
			this.snapshot_w = this.el['img_snp'].get(0).naturalWidth;
			this.snapshot_h = this.el['img_snp'].get(0).naturalHeight;
			this.adjustSize();
			if(this.device_connected === true) {
				this.fetchSnapshot();
			}
		}.bind(this), 10);
	} else if(data.error) {
		console.log(data.error);
	}
};

OnvifManager.prototype.getAudioCallback = function(data) {
	var blob = data.data;
	var reader = new FileReader();
	reader.readAsDataURL(blob);
	var self = this;
	reader.onloadend = function() {
		var base64data = reader.result;
		base64data = base64data.replace(/^data:application\/octet-stream;/, 'data:audio/wav;');
		// var arrayBuffer = b64ToArrayBuffer(btoa(base64data));
		self.playMic(base64data);
	};


	// let fileReader = new FileReader();
	// let arrayBuffer;
	//
	// fileReader.onloadend = () => {
	// 	arrayBuffer = fileReader.result;
	// 	this.playMic(arrayBuffer);
	// };
	//
	// fileReader.readAsArrayBuffer(blob);
	// var bufferLength = data.detail.data.length;
	// var audioBuffer = this.audio_context.createBuffer(1, bufferLength, 16000);
	// var arrayBuffer = new ArrayBuffer(bufferLength);
	// arrayBuffer.buffer = data.detail.data;
	// // for (var i = 0; i < bufferLength; i++) {
	// // 	// audioBuffer[i] = data.detail.data[i];
	// // 	audioBuffer[i] =  Math.random() * 2 - 1;
	// // }
	// console.log(arrayBuffer);
	// // this.audio_context.decodeAudioData(audioBuffer, function (decodedArrayBuffer) {
	// // 	audioBuffer = decodedArrayBuffer;
	// // });
	// // this.playMic(audioBuffer);
	// var destination = this.audio_context.destination;
	// this.audio_source = this.audio_context.createBufferSource();
	// // this.audio_source.buffer = audioBuffer;
	// audioBuffer.getChannelData( 0 ).set( audioBuffer );
	// this.audio_source.connect(destination);
	// this.audio_source.start(0);
	// self = this;
	// this.audio_source.onended = function () {
	// 	console.log('onended');
	// }
};

OnvifManager.prototype.playMic = function(data) {
	this.audio.src = data;
	var self = this;
	this.audio.addEventListener('loadeddata', function () {
		self.audio.play();
	});
	// audio.play();
};

OnvifManager.prototype.recAudio = function() {
	if (this.el['rec_audio'].val() === 'Rec (Off)') {
		this.sendRequest('recAudio', {action: "startRec"});
	} else if (this.el['rec_audio'].val() === 'Rec (On)') {
		this.sendRequest('recAudio', {action: "stopRec"});
	}
};

OnvifManager.prototype.pauseRec = function() {
	if (this.el['pause_audio'].val() === 'pause') {
		this.sendRequest('recAudio', {action: 'pauseRec'});
	} else if (this.el['pause_audio'].val() === 'resume') {
		this.sendRequest('recAudio', {action: 'resumeRec'});
	}
};

OnvifManager.prototype.recAudioCallback = function(data) {
	console.log(data);
	// this.el['rec_audio'].val('Rec (On)');
	if (data.status === 'started') {
		this.el['rec_audio'].val('Rec (On)');
		this.el['rec_audio'].text('Rec (On)');
	} else if (data.status === 'stop') {
		this.el['rec_audio'].val('Rec (Off)');
		this.el['rec_audio'].text('Rec (Off)');
	} else if (data.status === 'pause') {
		this.el['pause_audio'].val('resume');
		this.el['pause_audio'].text('Resume');
	} else if (data.status === 'resume') {
		this.el['pause_audio'].val('pause');
		this.el['pause_audio'].text('Pause');
	}
};

OnvifManager.prototype.ptzGotoHome = function(event) {
	event.preventDefault();
	event.stopPropagation();
	if(event.type === 'touchstart')  {
		return;
	}
	if(this.device_connected === false || this.ptz_moving === true) {
		return;
	}
	this.ptz_moving = true;
	this.sendRequest('ptzHome', {
		'address': this.selected_address,
		'timeout': 30
	});
};

OnvifManager.prototype.ptzMove = function(event) {
	if(this.device_connected === false || this.ptz_moving === true) {
		return;
	}
	this.ptz_moving = true;
	var pos = {x: 0, y: 0, z: 0};
	var speed = 1.0;

	if(event.type === 'keydown') {
		this.el['ptz_spd'].each(function(index, el) {
			if($(el).prop('checked') === true) {
				speed = parseFloat($(el).val());
			}
		}.bind(this));
		var c = event.keyCode;
		var s = event.shiftKey;
		if(c === 38) { // Up
			pos.y = speed;
		} else if(c === 40) { // Down
			pos.y = 0 - speed;
		} else if(c === 37) { // Left
			pos.x = 0 - speed;
		} else if(c === 39) { // Right
			pos.x = speed;
		} else if((c === 107) || c === 187) { // Zoom in
			pos.z = speed;
		} else if(c === 109 || c === 189) { // Zoom out
			pos.z = 0 - speed;
		} else {
			return;
		}
	} else if(event.type.match(/^(mousedown|touchstart)$/)) {
		if(event.currentTarget.classList.contains('ptz-pad-box')) {
			var rect = event.currentTarget.getBoundingClientRect();
			var cx = event.clientX;
			var cy = event.clientY;
			if(event.type === 'touchstart') {
				if(event.targetTouches[0]) {
					cx = event.targetTouches[0].clientX;
					cy = event.targetTouches[0].clientY;
				} else if(event.changedTouches[0]) {
					cx = event.changedTouches[0].clientX;
					cy = event.changedTouches[0].clientY;
				}
			}
			var mx = cx - rect.left;
			var my = cy - rect.top;
			var w = rect.width;
			var h = rect.height;
			var r = Math.max(w, h) / 2;
			var x = mx - r;
			var y = r - my;
			var d = Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2)) / r;
			var rad = Math.atan2(y, x);
			pos.x = d * Math.cos(rad);
			pos.y = d * Math.sin(rad);
		} else if(event.currentTarget.classList.contains('ptz-zom')) {
			if(event.currentTarget.classList.contains('ptz-zom-ot')) {
				pos.z = -1.0;
			} else if(event.currentTarget.classList.contains('ptz-zom-in')) {
				pos.z = 1.0;
			} else {
				return;
			}
		} else {
			return;
		}
	} else {
		return;
	}

	this.sendRequest('ptzMove', {
		'address': this.selected_address,
		'speed'  : pos,
		'timeout': 30
	});
	event.preventDefault();
	event.stopPropagation();
};

OnvifManager.prototype.ptzStop = function(event) {
	if(!this.selected_address) {
		return;
	}
	this.sendRequest('ptzStop', {
		'address': this.selected_address
	});
	this.ptz_moving = false;
};

OnvifManager.prototype.ptzMoveCallback = function(data) {
	// do nothing
};

OnvifManager.prototype.ptzStopCallback = function(data) {
	// do nothing
};

OnvifManager.prototype.ptzHomeCallback = function(data) {
	// do nothing
};

OnvifManager.prototype.saveScreenshot = function (data) {
	if ((data.ctrlKey && data.keyCode === 67) || data.type === 'click') {
		var src = this.el['img_snp'].attr('src');
		console.log(src);
		const blob = this.b64toBlob(src, 'image/jpeg');
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `Screen.jpeg`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}
};

OnvifManager.prototype.openSettings = function (data) {
	this.showSettingsModal();
};

OnvifManager.prototype.startAudio = function (data) {

};

OnvifManager.prototype.saveSettins = function (data) {
	data.preventDefault();
	var serializeForm = $(data.currentTarget).serialize();
	serializeForm = decodeURIComponent(serializeForm);

		/**
		 * формат данных
		 0: "device=192.168.1.10"
		 1: "port=8899"
		 2: "screen=Ctrl+C"
		 */
	var unserializeForm = serializeForm.split('&');
	var jsonSettings = {};

	unserializeForm.forEach(row => {
		var splitRow = row.split('=');
		jsonSettings[splitRow[0]] = splitRow[1];
	});

	this.sendRequest('saveSettings', {
		'settings': jsonSettings
	});
};

OnvifManager.prototype.saveSettinsCallback = function (data) {
	this.showMessageModal(data.id, data.detail);
};

OnvifManager.prototype.getSettings = function () {
	this.sendRequest('getSettings');
};

OnvifManager.prototype.getSettingsCallback = function (data) {
	if (data.result === 'ok') {
		this.user_settings = JSON.parse(data.detail);
		console.log(this.user_settings);
		this.get_settings_def.resolve();
	} else if (data.result === 'error') {
		this.showMessageModal('Error get settings', data.detail);
	}
};

OnvifManager.prototype.callSettings = function (data) {
	var inputVal = $(data.currentTarget).val();
	if (inputVal.indexOf('rrozum') !== -1) {
		this.showSettingsModal();
		$(data.currentTarget).val('');
	}
};

OnvifManager.prototype.callSettingsFocus = function (data) {
	var settingsDisplay = this.el['mdl_settings'][0].style.display;
	if (settingsDisplay === 'none' || settingsDisplay === '') {
		this.el['call_settings'].focus();
	}
};

OnvifManager.prototype.b64toBlob = (b64Data, contentType = '', sliceSize = 512) => {
	const byteCharacters = atob(b64Data.replace(/^data:image\/(png|jpeg|jpg);base64,/, ''));
	const byteArrays = [];

	for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
		const slice = byteCharacters.slice(offset, offset + sliceSize);

		const byteNumbers = new Array(slice.length);
		for (let i = 0; i < slice.length; i++) {
			byteNumbers[i] = slice.charCodeAt(i);
		}

		const byteArray = new Uint8Array(byteNumbers);

		byteArrays.push(byteArray);
	}

	return new Blob(byteArrays, {type: contentType});
};

function b64ToArrayBuffer(base64) {
	var binary_string =  window.atob(base64);
	var len = binary_string.length;
	var bytes = new Uint8Array( len );
	for (var i = 0; i < len; i++)        {
		bytes[i] = binary_string.charCodeAt(i);
	}
	return bytes.buffer;
}

})();
