# Daily CloudFront+S3 HLS demo

This project provides an example of the cloud infrastructure necessary
for serving HLS live streams using CloudFront signatures to protect
access.

## Setup
* `npm install -g typescript`
* `npm install -g aws-cdk`

## Instructions

* `openssl genrsa -out private_key-[daily_subdomain].pem 2048`
* `openssl rsa -pubout -in private_key-[daily_subdomain].pem -out public_key-[daily_subdomain].pem`
* `cdk bootstrap -c dailySubdomain=[daily_subdomain]`
* `cdk deploy --context dailySubdomain=[daily_subdomain]`

The output of the `cdk deploy` command will include the names of the
S3 bucket and the IAM role configured for Daily, as well as the DNS
name of the CloudFront distribution.  You'll use these to configure
your Daily domain and/or rooms for outputting HLS live streams and/or
recordings.

## Playing streams

You can play streams in multiple ways:

### Playing streams using the included player

Visit `https://[cloudfront_domain_name]/index.html?prefix=[S3 object key prefix]&mtgSessionId=[your meeting session ID]`
to play the stream using the included player.

### Playing streams using another player

You can use the URL `https://[cloudfront_domain_name]/play?prefix=[S3 object key prefix]&mtgSessionId=[your meeting session ID]`
to play the stream in another player.  Using an external player is
subject to browser security restrictions and may require some additional
configuration:

* The player will need to set the `withCredentials` [attribute](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/withCredentials)
  to `true` on its XMLHTTPRequests
* The player's origin will need to be allowed in the CORS policies configured
  by this stack.  Edit the file `lib/daily-cloudfront-hls-example-stack.ts` and
  include any additional origins necessary before deploying this stack.

## CloudFront Signed Cookies

This project includes an example [Lambda@Edge](https://aws.amazon.com/lambda/edge/)
[function](signing-lambda/index.js) which demonstrates how to generate signed cookies
which can be used to add a level of protection to the content published.  The Lambda
function has been simplified for demo purposes, and should not be used as-is in
production-grade deployments.  Known limitations include:

* We deploy the CloudFront signature private key and key ID into a single region,
  `us-east-1`, to keep the stack easy to deploy.  In a production environment, it would
  be preferable to locate the private key and key ID in each region with a lambda, to
  improve Lambda execution time, and eliminate the global dependency on `us-east-1`.
* You should determine your own policy to apply to the content protection.  This
  lambda uses a simple, permissive policy for demo purposes.
