/* Copyright (c) 2012-2013 Cristian Ianto, MIT License */
"use strict";

var _              = require('underscore');
var fs             = require('fs');
var path           = require('path');
var URL            = require('url');
var ejs            = require('ejs');

var Stripe         = require('stripe');

var name = "pay-stripe-checkout"


module.exports = function(options) {

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

    if(args.redirect) {
      //this bit should probably just be removed.
      hostUrl = args.redirect.hostUrl;
      successUrl = args.redirect.success;
      failUrl = args.redirect.fail;
    } else {
      hostUrl    = options.redirect.hostUrl;
      successUrl = options.redirect.success;
      failUrl    = options.redirect.fail;
    }

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

    var input = req.body;
    var transactionData = {
      refno:input.refno,
      status:'created',
      customer: {
        name: input.name,
        company: input.company,
        email: input.email
      },
      description: input.description,
      priceTag: input.priceTag,
      amount: input.amount,
      currencyCode: input.currencyCode,
      plan: input.plan
    };

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
          panelTitle: input.panelTitle,
          submitText: input.submitText,
          name: input.name,
          company: input.company,
          email: input.email,
          amount: input.amount,
          currencyCode: input.currencyCode,
          plan: input.plan,
          description: input.description,
          priceTag: input.priceTag,
          refno: transaction.refno
        };
        _.defaults(data, checkoutPanelOptions);
        res.write(ejs.render(str, data));
        res.end()
      })

    })
  }

  function completeCallbackHandler(req, res, next) {

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
      transaction.stripe = { token:stripeToken };
      transaction.status = 'started';

      seneca.act({
        role : 'transaction',
        cmd  : 'update',
        id   : transaction.id,
        data : transaction
      }, function(err, t) {
       if (err) {
         // TODO: handle
        return cb(err)
        }

      // prepare the charge
      var name = req.query['name'] || req.body['name'] || transaction.customer.name;
      var company = req.query['company'] || req.body['company'] || transaction.customer.company;
      var email = req.query['email'] || req.body['email'] || transaction.customer.email;
      var amount = req.query['amount'] || req.body['amount'] || transaction.amount;
      var plan = req.query['plan'] || req.body['plan'] || transaction.plan;
      var currencyCode = req.query['currencyCode'] || req.body['currencyCode'] || transaction.currencyCode;
      var description = req.query['description'] || req.body['description'] || transaction.description;

      if (plan && plan.length>0) {

         // subscribe user to plan
        stripe.customers.create({
          email: email,
          description: company + ' ' + name,
          plan: plan,
          card: stripeToken
        }, function(err, customer) {
          if (err) {
            seneca.log.debug(err);
            transaction.status = 'failed';
            transaction.error = { name: err.name, message: err.message };
            seneca.act({role:'transaction', cmd:'update', id:transaction.id, data:transaction}, function() {
              res.redirect(urlappend(failUrl, 'refno', transaction.refno));
            })
            return
          }

        seneca.log.debug(customer);
        transaction.status = 'completed';
        transaction.stripe.customer = customer;
        seneca.act({role:'transaction', cmd:'update', id:transaction.id, data:transaction}, function() {
          res.redirect(urlappend(successUrl, 'refno', transaction.refno));
        })

        })
      }
      else {

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
        transaction.stripe.charge = charge;
        seneca.act({role:'transaction', cmd:'update', id:transaction.id, data:transaction}, function() {
          res.redirect(urlappend(successUrl, 'refno', transaction.refno));
        })

        })
      }

      })
    }

  }

  function cancelCallbackHandler(req, res, next) {
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

  return {name: name}

}
