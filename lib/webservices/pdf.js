"use strict";
var spawn = require('child_process').spawn;
var path = require('path');
var fs = require('fs');
var uuid = require('node-uuid');
var format = require('util').format;
var request = require('request');
var slugifyUrl = require('slugify-url');

var pdfExecutable = 'phantomjs';
if (process.platform === 'win32') {
	pdfExecutable = 'phantomjs.exe';
}
if (process.platform !== 'darwin') {
	pdfExecutable = path.resolve(path.join('bin', pdfExecutable));
}
var FORMATS = ['A3', 'A4', 'A5', 'Legal', 'Letter', 'Tabloid'];
var ORIENTATIONS = ['portrait', 'landscape'];
var marginRegExp = /^((\d)|(\d\.\d))+(in|cm|mm)$/;
var zoomRegExp = /^\d(\.\d{1,3})?$/;
var dataUrlRegex = /^data:([a-zA-Z0-9!#$%^&\*_\-\+{}\|'.`~]+\/[a-zA-Z0-9!#$%^&\*_\-\+{}\|'.`~]+)?(;[a-zA-Z0-9]+=[a-zA-Z0-9\-]+)*(;base64)?,/;
var bucketName = 'fuzu.com-pdfs';


module.exports = function (app, s3) {
	app.post('/generate', function (req, res, next) {
		var url = req.body.url;
		var filename = slugifyUrl(url);

		if (req.body.filename) {
			filename = req.body.filename;
		}

		var appKey = req.body.appkey;
		if(appKey !== process.env.APP_KEY){
			return res.status(400).send(format('Invalid appkey specified'));
		}

		var folder = req.body.folder;
		var keyName = folder + '/' + filename + '_' + uuid.v4() + ".pdf";

		if (!url) {
			return res.status(400).send(format('Invalid URL specified'));
		}

		var isDataUrl = dataUrlRegex.exec(url);
		if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0 && !isDataUrl) {
			url = 'http://' + url;
		}

		var paperFormat = req.body.format || 'A4';
		if(FORMATS.indexOf(paperFormat) === -1){
			return res.status(400).send(format('Invalid format, the following are supported: %s', FORMATS.join(', ')));
		}
		var orientation = req.body.orientation || 'portrait';
		if(ORIENTATIONS.indexOf(orientation) === -1){
			return res.status(400).send(format('Invalid orientation, the following are supported: %s', ORIENTATIONS.join(', ')));
		}
		var margin = req.body.margin || '1cm';
		if(!marginRegExp.test(margin)){
			return res.status(400).send(format('Invalid margin, the following formats are supported: 0cm, 1cm, 2cm, 1in, 13mm'));
		}
		var zoom = req.body.zoom || '1';
		if(!zoomRegExp.test(zoom)){
			return res.status(400).send(format('Invalid zoom, the following kind of formats are supported: 1, 0.5, 9.25, 0.105'));
		}

		if (!isDataUrl) {
			request.head(url, function (err, resp) {
				if (err) {
					return res.status(400).send(format('Cannot get %s: %s', url, err.message));
				}
				if (!/2\d\d/.test(resp.statusCode)) {
					return res.status(400).send(format('Cannot get %s: http status code %s', url, resp.statusCode));
				}
				if(!/text|html/.test(resp.headers['content-type'])){
					return sendMimeError(res, url, resp.headers['content-type']);
				}
				generatePdf(keyName, folder);
			});
		} else {
			var mime = isDataUrl[1];
			if (!/text|html/.test(mime)) {
				return sendMimeError(res, url, mime);
			}
			generatePdf(keyName, folder);
		}


		function generatePdf(keyName, folder) {
			var tmpFile = path.join(__dirname, '../../tmp', uuid.v4() + '.pdf');
			var outputLog = '';
			req.connection.setTimeout(2 * 60 * 1000); //two minute timeout
			var options = [
				'--web-security=no',
				'--ssl-protocol=any',
				path.join(__dirname, '../rasterize/rasterize.js'),
				url,
				tmpFile,
				paperFormat,
				orientation,
				margin,
				zoom
			];
			var pdfProcess = spawn(pdfExecutable, options);
			pdfProcess.stdout.on('data', function (data) {
				console.log('pdf: ' + data);
				outputLog += data;
			});
			pdfProcess.stderr.on('data', function (data) {
				console.error('pdf: ' + data);
				outputLog += data;
			});
			pdfProcess.on('close', function (code) {
				if (code) {
					if(code===100){
						return res.status(400).send(outputLog);
					}
					return next(new Error('Wrong code: ' + code));
				}

				fs.readFile(tmpFile, function (err, data) {
					if (err) { throw err; }

					var base64data = new Buffer(data, 'binary');

					var params = {
						Bucket: bucketName, 
						Key: keyName, 
						Body: base64data, 
						ContentType: 'application/pdf', 
						ContentDisposition: 'inline'
					};

				  	s3.putObject(params, function(err, data) {
					    if (err) {
					      	console.log(err)
					      	fs.unlink(tmpFile);
					  	  	return res.status(400).send(format('Invalid URL specified'));
					  	} else {
					      	console.log("Successfully uploaded data to " + bucketName + "/" + keyName);
					        fs.unlink(tmpFile);

					      	res.setHeader('Content-Type', 'application/json');
    						return res.send(JSON.stringify({ "url": "https://s3.amazonaws.com/fuzu.com-pdfs/" + keyName}));
						} 
					});
				});
			});	
		}
	});
};

function sendMimeError(res, url, mime) {
	return res.status(400).send(format(
		'Cannot get %s: returns content type %s. You must point html2pdf.it to HTML or TEXT content',
		url,
		mime
	));
}
