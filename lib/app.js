"use strict";
var path = require('path');
var express = require('express');
var middleware = require('./middleware');
var compression = require('compression');
var morgan = require('morgan');

var env = process.env.APP_ENV || 'production';
var config = require('../config/' + env + '.app.config.js');
var app = express();
var bodyParser = require('body-parser')

process.chdir(path.join(__dirname, '..'));
var AWS = require('aws-sdk');
var uuid = require('node-uuid');
var s3 = new AWS.S3();

app.use(middleware.domain());
app.use(morgan('combined'));
app.use(compression());
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());
require('./webservices/pdf.js')(app, s3);
app.use(express['static'](__dirname + '/../public', {clientMaxAge: -1000 * 60 * 60 * 24}));
app.use(express['static'](__dirname + '/../favicon', {clientMaxAge: -1000 * 60 * 60 * 24}));
app.use(function (err, req, res, next) {
	console.error(err.stack);
	res.status(500).send('Something broke!');
});


app.listen(config.http.port);
console.log('Listening on http://localhost:' + config.http.port + '/');

module.exports = {
	app: app
};