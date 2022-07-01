const AWS = require("aws-sdk");
const fs = require("fs");

AWS.config.update({ region: "us-east-1" });

const secretsmanager = new AWS.SecretsManager();
const ssm = new AWS.SSM();

let privateKey = null,
  keyId = null;

async function init() {
  const secretResponse = await secretsmanager
    .getSecretValue({ SecretId: "daily-cloudfront-hls-private-key" })
    .promise();
  privateKey = secretResponse.SecretString;

  const paramResponse = await ssm
    .getParameter({ Name: "/daily-cloudfront-hls-example/key-pair-id" })
    .promise();
  keyId = paramResponse.Parameter.Value;
}

exports.handler = async (event, context, callback) => {
  if (!privateKey || !keyId) {
    await init();
  }

  const request = event.Records[0].cf.request;
  const cfconfig = event.Records[0].cf.config;
  const queryPairs = request.querystring.split("&");
  const queryDict = {};
  queryPairs.forEach((p) => {
    const kv = p.split("=");
    if (kv.length > 1) {
      queryDict[kv[0]] = kv[1];
    }
  });

  const prefix = queryDict["prefix"];
  const mtgSessionId = queryDict["mtgSessionId"];

  let resource = `https://${cfconfig.distributionDomainName}/${prefix}/${mtgSessionId}/master.m3u8`;
  let cookieDomain = cfconfig.distributionDomainName;
  let cookiePath = `/`;
  let pathFilter = `https://${cfconfig.distributionDomainName}/${prefix}/${mtgSessionId}/*`;
  let startDateTime = Math.floor(Date.now() / 1000 - 60);
  let expiration = Math.floor(Date.now() / 1000 + 3600 * 3);
  let customPolicy = {
    Statement: [
      {
        Resource: pathFilter,
        Condition: {
          DateLessThan: {
            "AWS:EpochTime": expiration,
          },
          DateGreaterThan: {
            "AWS:EpochTime": startDateTime,
          },
        },
      },
    ],
  };
  customPolicy = JSON.stringify(customPolicy);

  const cookieSigner = new AWS.CloudFront.Signer(keyId, privateKey);
  const signedCookie = await cookieSigner.getSignedCookie({
    policy: customPolicy,
  });
  console.log(signedCookie);

  const response = {
    status: 302,
    statusDescription: "Found",
    headers: {
      Location: [
        {
          key: "Location",
          value: resource,
        },
      ],
      "Set-Cookie": [
        {
          key: "Set-Cookie",
          value: `CloudFront-Policy=${signedCookie["CloudFront-Policy"]}; Domain=${cookieDomain}; Expires=${expiration}; SameSite=None; Secure`,
        },
        {
          key: "Set-Cookie",
          value: `CloudFront-Signature=${signedCookie["CloudFront-Signature"]}; Domain=${cookieDomain}; Expires=${expiration}; SameSite=None; Secure`,
        },
        {
          key: "Set-Cookie",
          value: `CloudFront-Key-Pair-Id=${signedCookie["CloudFront-Key-Pair-Id"]}; Domain=${cookieDomain}; Expires=${expiration}; SameSite=None; Secure`,
        },
      ],
    },
  };
  callback(null, response);
};
