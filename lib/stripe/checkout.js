/* Copyright (c) 2012-2013 Cristian Ianto, MIT License */
"use strict";

var _              = require('underscore');
var fs             = require('fs');
var path           = require('path');
var URL            = require('url');
var ejs            = require('ejs');

var Stripe         = require('stripe');

var name = "pay-stripe-checkout"


module.exports = function(){
  var seneca = this;

  var endpoints = {
    pay: '/pay/stripe-checkout/pay',
    completeCallback: '/pay/stripe-checkout/callback-complete',
    cancelCallback: '/pay/stripe-checkout/callback-cancel'
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

    routes[endpoints.pay] = { POST:payHandler };
    routes[endpoints.completeCallback] = { GET:completeCallbackHandler, POST:completeCallbackHandler };
    routes[endpoints.cancelCallback] = { GET:cancelCallbackHandler, POST:cancelCallbackHandler };

    done(null, routes)
  })

  function urlappend(url, name, value) {
    var urlobj = URL.parse(url, true);
    if (typeof value !== 'undefined' && value !== null) {
      urlobj.query[name] = value;
    }
    return URL.format(urlobj);
  }

  function payHandler(req, res, next) {
    console.log('pay handler');

    var input = req.body;
    var transactionData = { refno:input.refno, status:'created' };

    seneca.act({role:'transaction', cmd:'create', data:transactionData}, function(err, out) {
      if (err) {
        res.redirect(urlappend(failUrl, 'refno', input.refno));
        return
      }

      var transaction = out.transaction;

      fs.readFile(path.join(__dirname, '../../views/checkout.ejs'), 'utf8', function(err, str) {
        var data = {
          completeCallbackUrl: endpoints.completeCallback,
          cancelCallbackUrl: endpoints.cancelCallback,
          amount: input.amount,
          currencyCode: input.currencyCode,
          description: input.description,
          refno: transaction.refno
        };
        _.extend(data, checkoutPanelOptions);
        res.write(ejs.render(str, data));
        res.end()
      })

    })
  }

  function completeCallbackHandler(req, res, next) {
    console.log('complete handler');

    // refno - internal transaction reference number
    var refno = req.query['refno'] || req.body['refno'];
    var stripeToken = req.query['stripeToken'] || req.body['stripeToken'];

    // need a stripe token
    if (typeof stripeToken ==='undefined' || stripeToken===null || stripeToken.length===0) {
        seneca.log.error('complete', 'transaction', 'error', new Error('No token'), {refno:refno})
        res.redirect(urlappend(failUrl, 'refno', refno));
        return
    }

    // lookup transaction by refno
    seneca.act({role:'transaction', cmd:'find', q:{'refno':refno}}, function(err, out) {
      if (err) {
        seneca.log.error('find', 'transaction', 'error', err, {refno:refno})
        res.redirect(urlappend(failUrl, 'refno', refno));
        return
      }

      if (!out.ok) {
        var transactionData = { refno:refno, status:'created' }
        seneca.act({role:'transaction', cmd:'create', data:transactionData}, function(err, out) {
          if (err || !out.ok) {
            res.redirect(urlappend(failUrl, 'refno', input.refno));
            return
          }
          _charge(out.transaction)
        })
      }
      else {
        _charge(out.transaction)
      }

    });

    function _charge(transaction) {

      // don't allow reprocessing
      if (transaction.status !== 'created') {
          res.redirect(urlappend(failUrl, 'refno', refno));
          return
      }

      // save token and update transaction status
      transaction.stripeCheckout = { token:stripeToken };
      transaction.status = 'started';

      seneca.act({role:'transaction', cmd:'update', id:transaction.id, data:transaction}, function(err) {
        if (err) {
         // TODO: handle
        }

      // prepare the charge
      var amount = req.query['amount'] || req.body['amount'];
      var currencyCode = req.query['currencyCode'] || req.body['currencyCode'];
      var description = req.query['description'] || req.body['description'];

      // charge credit card
      stripe.charges.create({
        amount: parseFloat(amount)*100,
        currency: currencyCode,
        description: description,
        card: stripeToken
      }, function(err, charge) {
        if (err) {
          seneca.log.debug(err);
          transaction.status = 'failed';
          transaction.error = { name: err.name, message: err.message };
          seneca.act({role:'transaction', cmd:'update', id:transaction.id, data:transaction}, function() {
            res.redirect(urlappend(failUrl, 'refno', transaction.refno));
          })
          return
        }

      seneca.log.debug(charge);
      transaction.status = 'completed';
      transaction.charge = charge;
      seneca.act({role:'transaction', cmd:'update', id:transaction.id, data:transaction}, function() {
        res.redirect(urlappend(successUrl, 'refno', transaction.refno));
      })

      }) })
    }

  }

  function cancelCallbackHandler(req, res, next) {
    console.log('cancel handler');

    var refno = req.query['refno'];

    seneca.act({role:'transaction', cmd:'find', q:{'refno':refno}}, function(err, out) {
      if (err) {
        seneca.log.error('find', 'transaction', 'error', err, {token:token})
        res.redirect(urlappend(failUrl, 'refno', refno));
        return
      }

    var transaction = out.transaction;
    transaction.status = 'cancelled';

    seneca.act({role:'transaction', cmd:'update', id:transaction.id, data:transaction}, function(err) {

      res.redirect(urlappend(failUrl, 'refno', refno));

    }) })
  }

}
