/* Copyright (c) 2013 Cristian Ianto, MIT License */
"use strict";


var fs            = require('fs')

var _              = require('underscore')


var name = "stripe-pay"


module.exports = function(options, register) {
  var seneca = this

  require('./stripe/checkout').call(seneca);

  seneca.add({role:'pay', hook:'init', sub:'gateway'}, function (args, done) {
    this.parent( args, function() {
      seneca.log.debug('stripe: init gateway')

      var actargs = {role:'pay-stripe-checkout', cmd:'init-gateway', options:args.options.stripe};
      seneca.act(actargs, function(err) {
        done(err)
      })
    })
  })

  seneca.add({role:'pay', hook:'init', sub:'routes'}, function (args, done) {
    this.parent( args, function() {
      seneca.log.debug('stripe: init routes')

      var actargs = {role:'pay-stripe-checkout', cmd:'init-routes', options:args.options, routes:args.routes, redirect:args.options.redirect};
      seneca.act(actargs, function(err, routes) {
        done(err, routes)
      })
    })
  })

  register(null,{
    name:name
  })

}

