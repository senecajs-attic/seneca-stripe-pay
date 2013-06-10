/* Copyright (c) 2012-2013 Cristian Ianto, MIT License */
"use strict";

var _              = require('underscore');
var fs             = require('fs');
var path           = require('path');
var ejs            = require('ejs');

var Stripe         = require('stripe');

var name = "pay-stripe-checkout"


module.exports = function(){
  var seneca = this;

  var endpoints = {
    pay: '/pay/stripe-checkout/pay',
    doPay: '/pay/stripe-checkout/do-pay'
  }

  var stripe;

  var checkoutPanelOptions = {
    showAddress: true
  }

  seneca.add({role:name, cmd:'init-gateway'}, function (args, done) {
    var options = args.options;

    stripe = new Stripe(options.secretKey);

    _.extend(checkoutPanelOptions, _.pick(options, [
      'showAddress', 'companyName', 'brandImage', 'panelTitle', 'submitText'
    ]))
    checkoutPanelOptions.stripeKey = options.publishableKey;

    done(null, stripe)
  })

  var hostUrl;
  var successUrl, failUrl;

  seneca.add({role:name, cmd:'init-routes'}, function (args, done) {
    var routes = args.routes;

    hostUrl = args.redirect.hostUrl;
    successUrl = args.redirect.success;
    failUrl = args.redirect.fail;

    routes[endpoints.pay] = { POST: payHandler };
    routes[endpoints.doPay] = { POST: doPayHandler };

    done(null, routes)
  })

  function urljoin () {
    var args = [].slice.call(arguments)
    return args.join('/').replace(/\/+/g, '/').replace(/:\//,'://')
  }

  function payHandler(req, res, next) {
    seneca.log.debug('pay handler');

    var input = req.body;

    fs.readFile(path.join(__dirname, '../../public/views/checkout.ejs'), 'utf8', function(err, str) {
      var data = {
        returnUrl: endpoints.doPay,
        amount: parseFloat(input.amount)*100,
        currencyCode: input.currencyCode,
        description: input.description
      };
      _.extend(data, checkoutPanelOptions);
      res.write(ejs.render(str, data));
      res.end()
    });
  }

  function doPayHandler(req, res, next) {
    seneca.log.debug('do-pay handler');

    res.redirect(failUrl)
  }
}
