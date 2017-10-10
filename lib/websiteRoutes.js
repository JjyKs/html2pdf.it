"use strict";
module.exports = function(http){
	http.post('/generate', function(req, res, next){
		req.url = '/index.html';
		next();
	});
};