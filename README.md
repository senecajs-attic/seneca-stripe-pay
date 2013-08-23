# seneca-stripe-pay - Node.js module
 
## Stripe payments strategy for seneca-pay <a href="https://github.com/rjrodger/seneca">Seneca</a> plugin

Dependencies: [seneca-pay](/iantocristian/seneca-pay)

NOTE: documentation is in progress. Take a look at the <a href="http://github.com/rjrodger/seneca-examples">payment gateway example</a>.

### Usage

     seneca.use('seneca-pay',{
        stripe: {
          secretKey: 'my-stripe-secret-key',
          publishableKey: 'stripe-publishable-key'
        },
        redirect: {
          hostUrl: 'http://www.mywebsite.com',
          success: '/completed',
          fail: '/cancelled'
        }
     })

     seneca.use('seneca-stripe-pay')

Additional stripe config options:

    * showAddress: true/false ; true to require address input
    * companyName: optional text to be displayed as the company or website name on the checkout panel
    * brandImage: optional image (specified as a relative url) to be displayed on the checkout panel
    * panelTitle: optional text to be used as title for the checkout panel
    * submitText: optional text for the Pay button (defaults to Pay)













