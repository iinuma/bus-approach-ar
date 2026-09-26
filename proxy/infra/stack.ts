/**
 * バス接近AR の中継。Lambda Function URL 1 本だけ（G2 Sky View・Tokyojihatsu と同じ形）。
 */

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export interface ProxyStackProps extends StackProps {
  appKey: string;
  /** ODPT トークンを入れた SSM パラメータ名（SecureString）。読むだけ。 */
  tokenParameterName: string;
}

export class KawasakiBusProxyStack extends Stack {
  constructor(scope: Construct, id: string, props: ProxyStackProps) {
    super(scope, id, props);

    // ログは 1 週間で捨てる。障害の切り分け以上の用途がない。
    const logGroup = new LogGroup(this, 'RtProxyLogs', {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new NodejsFunction(this, 'RtProxy', {
      entry: resolve(here, '../src/lambda.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(15),
      // 同時実行の予約はしない（G2 Sky View と同じ。予約するとデプロイが落ちることがある）。
      logGroup,
      environment: { APP_KEY: props.appKey, ODPT_TOKEN_PARAM: props.tokenParameterName },
      bundling: {
        minify: true,
        sourceMap: false,
        // AWS SDK は Lambda ランタイムに同梱されているのでバンドルしない。
        externalModules: ['@aws-sdk/*'],
      },
    });

    StringParameter.fromSecureStringParameterAttributes(this, 'OdptToken', { parameterName: props.tokenParameterName }).grantRead(fn);

    const url = fn.addFunctionUrl({
      authType: FunctionUrlAuthType.NONE,
      // CORS は Function URL 側では設定しない（ハンドラと重なって WebView の fetch が落ちる）。
    });

    new CfnOutput(this, 'ProxyUrl', {
      value: url.url,
      description: 'app.json の whitelist と VITE_RT_PROXY に設定する URL',
    });
  }
}
