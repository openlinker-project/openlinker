/**
 * AWS SigV4 signer tests (#4179)
 *
 * The first case is AWS's own published example (IAM `ListUsers`, General
 * Reference "Signature Version 4 signing process"): same credentials, date,
 * request and expected signature.
 *
 * @module libs/integrations/amazon/src/infrastructure/http/__tests__
 */
import { signAwsRequest } from '../aws-sigv4';

const EXAMPLE_CREDENTIALS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

describe('signAwsRequest', () => {
  it('should reproduce the signature of the AWS published example', () => {
    const headers = signAwsRequest({
      method: 'GET',
      url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: '',
      region: 'us-east-1',
      service: 'iam',
      credentials: EXAMPLE_CREDENTIALS,
      now: new Date('2015-08-30T12:36:00Z'),
    });

    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-date, ' +
        'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
    expect(headers['x-amz-date']).toBe('20150830T123600Z');
    expect(headers.host).toBe('iam.amazonaws.com');
  });

  it('should keep the caller headers and never put the secret in a header', () => {
    const headers = signAwsRequest({
      method: 'POST',
      url: 'https://sqs.eu-west-1.amazonaws.com/',
      headers: { 'Content-Type': 'application/x-amz-json-1.0', 'X-Amz-Target': 'AmazonSQS.ReceiveMessage' },
      body: '{"QueueUrl":"q"}',
      region: 'eu-west-1',
      service: 'sqs',
      credentials: EXAMPLE_CREDENTIALS,
      now: new Date('2026-11-17T12:00:00Z'),
    });

    expect(headers['X-Amz-Target']).toBe('AmazonSQS.ReceiveMessage');
    expect(headers.authorization).toContain('SignedHeaders=content-type;host;x-amz-date;x-amz-target');
    expect(JSON.stringify(headers)).not.toContain(EXAMPLE_CREDENTIALS.secretAccessKey);
  });
});
