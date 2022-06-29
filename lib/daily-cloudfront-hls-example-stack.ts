import { CfnOutput, Stack, StackProps, Duration, SecretValue, aws_s3, aws_s3_deployment, aws_iam, aws_cloudfront, aws_cloudfront_origins, aws_lambda, aws_secretsmanager, aws_ssm } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class DailyCloudfrontHlsExampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'DailyCloudfrontHlsExampleQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    const hlsS3Bucket = new aws_s3.Bucket(
      this,
      "hlsS3Bucket",
      {
        encryption: aws_s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true
      }
    );

    const player_file = fs.readFileSync("index.html").toString();

    const playerPageObject = new aws_s3_deployment.BucketDeployment(this, "hlsBucketDeployment", {
      sources: [aws_s3_deployment.Source.data("index.html", player_file)],
      destinationBucket: hlsS3Bucket
    });

    const dailySubdomain = this.node.tryGetContext("dailySubdomain");

    const dailyRole = new aws_iam.Role(this, "dailyRole", {
      description: "Role allowing Daily to record to bucket",
      maxSessionDuration: Duration.hours(12),
      assumedBy: new aws_iam.AccountPrincipal("291871421005"),
      externalIds: [dailySubdomain],
    });

    dailyRole.addToPolicy(
      new aws_iam.PolicyStatement({
        effect: aws_iam.Effect.ALLOW,
        actions: [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucketMultipartUploads",
          "s3:AbortMultipartUpload",
          "s3:ListBucketVersions",
          "s3:ListBucket",
          "s3:GetObjectVersion",
          "s3:ListMultipartUploadParts",
        ],
        // Connects the bucket to the role
        resources: [
          hlsS3Bucket.bucketArn,
          hlsS3Bucket.arnForObjects("*"),
        ],
      })
    );

    const oaid = new aws_cloudfront.OriginAccessIdentity(this, "oaid", {
      comment: "Allows CloudFront to access private S3 bucket"
    });

    hlsS3Bucket.grantRead(oaid);
    const public_key = fs.readFileSync("public_key.pem").toString();
    const private_key = fs.readFileSync("private_key.pem").toString();
    const lambda_code = fs.readFileSync("signing-lambda/index.js").toString();

    const cloudfrontKey = new aws_cloudfront.PublicKey(this, "cloudfrontKey", {
      encodedKey: public_key,
    });
    const signingKeyPairId = new aws_ssm.StringParameter(this, "signingKeyPairId", {
      stringValue: cloudfrontKey.publicKeyId,
      parameterName: "/daily-cloudfront-hls-example/key-pair-id"
    });
    const cloudfrontKeyGroup = new aws_cloudfront.KeyGroup(this, "cloudfrontKeyGroup", {
      items: [ cloudfrontKey ]
    });

    const privateKeySecret = new aws_secretsmanager.Secret(this, "privateKeySecret", {
      description: "Cookie signing key for CloudFront",
      secretName: "daily-cloudfront-hls-private-key",
      secretStringValue: SecretValue.unsafePlainText(private_key)
    });

    const lambdaRole = new aws_iam.Role(this, "lambdaRole", {
      description: "Role for Cookie signing lambda",
      assumedBy: new aws_iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [aws_iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")]
    });
    lambdaRole.addToPolicy(
      new aws_iam.PolicyStatement({
        effect: aws_iam.Effect.ALLOW,
        actions: [
          "secretsmanager:GetSecretValue"
        ],
        resources: [
          privateKeySecret.secretArn
        ]
      })
    );
    lambdaRole.addToPolicy(
      new aws_iam.PolicyStatement({
        effect: aws_iam.Effect.ALLOW,
        actions: [
          "ssm:GetParameter"
        ],
        resources: [
          signingKeyPairId.parameterArn
        ]
      })
    );


    const signingLambda = new aws_cloudfront.experimental.EdgeFunction(this, "signingLambda", {
      runtime: aws_lambda.Runtime.NODEJS_14_X,
      handler: "index.handler",
      role: lambdaRole,
      code: aws_lambda.Code.fromInline(lambda_code),
    });

    const s3Origin = new aws_cloudfront_origins.S3Origin(hlsS3Bucket, {
      originAccessIdentity: oaid
    });

    const corsPolicy = new aws_cloudfront.ResponseHeadersPolicy(this, "corsPolicy", {
      comment: "Allows cross-domain access and the use of cookies",
      corsBehavior: {
        accessControlAllowCredentials: true,
        accessControlAllowHeaders: [ "Content-Type" ],
        accessControlAllowMethods: [ "GET", "OPTIONS" ],
        // Add origin of your video player to this list
        accessControlAllowOrigins: [ "*netlify.app", "*jwplayer.com", "*hlsplayer.net", "*playerjs.com", "*daily.co" ],
        originOverride: true
      }
    });

    const playlistCachePolicy = new aws_cloudfront.CachePolicy(this, "playlistCachePolicy", {
      defaultTtl: Duration.seconds(1),
      minTtl: Duration.seconds(1),
      maxTtl: Duration.seconds(1)
    });

    const segmentCachePolicy = new aws_cloudfront.CachePolicy(this, "segmentCachePolicy", {
      defaultTtl: Duration.seconds(60),
      minTtl: Duration.seconds(60),
      maxTtl: Duration.seconds(60)
    });

    const cloudfrontDist = new aws_cloudfront.Distribution(this, "cloudfrontDist", {
      defaultBehavior: {
        origin: s3Origin,
        responseHeadersPolicy: corsPolicy,
        trustedKeyGroups: [ cloudfrontKeyGroup ]
      },

      additionalBehaviors: {
        "*.m3u8": {
          origin: s3Origin,
          responseHeadersPolicy: corsPolicy,
          trustedKeyGroups: [ cloudfrontKeyGroup ],
          cachePolicy: playlistCachePolicy
        },
        "*.ts": {
          origin: s3Origin,
          responseHeadersPolicy: corsPolicy,
          trustedKeyGroups: [ cloudfrontKeyGroup ],
          cachePolicy: segmentCachePolicy
        },
        "/play": {
          origin: s3Origin,
          responseHeadersPolicy: corsPolicy,
          edgeLambdas: [
            {
              eventType: aws_cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
              functionVersion: signingLambda.currentVersion
            }
          ]
        },
        "/index.html": {
          origin: s3Origin,
        }
      }
    });

    // Outputs are defined below:

    new CfnOutput(this, "bucketName", {
      value: hlsS3Bucket.bucketName,
      description: "Name of S3 bucket",
      exportName: "bucketName"
    });

    new CfnOutput(this, "bucketRegion", {
      value: this.region,
      description: "Region where S3 bucket is located",
      exportName: "bucketRegion"
    });

    new CfnOutput(this, "roleArn", {
      value: dailyRole.roleArn,
      description: "ARN of IAM role for Daily to assume",
      exportName: "roleArn"
    });

    new CfnOutput(this, "cloudfrontDistDomain", {
      value: cloudfrontDist.domainName,
      description: "Domain name of CloudFront distribution",
      exportName: "cloudfrontDistDomain"
    });

  }
}
