#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DailyCloudfrontHlsExampleStack } from '../lib/daily-cloudfront-hls-example-stack';

const app = new cdk.App();

const subdomain = app.node.tryGetContext("dailySubdomain");
if (subdomain === undefined || !(typeof(subdomain) === 'string') || subdomain.trim() === '') {
  throw new Error("Must pass a '-c dailySubdomain=<daily_subdomain>' context parameter");
}

new DailyCloudfrontHlsExampleStack(app, `DailyCloudfrontHlsExampleStack-${subdomain}`, {
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
  env: { region: 'us-east-1' }
});
