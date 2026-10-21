import {expect} from 'chai';
import {sealWebhookFields, openWebhookRow, maskWebhookUrl, revealSigningSecret} from './webhookSecrets';

// Webhook urls and header values are stored encrypted (#46).
describe('webhookSecrets (#46)', function () {
  beforeEach(function () {
    process.env.TS_ENCRYPTION_KEY = 'webhook-secrets-spec-key';
  });

  afterEach(function () {
    delete process.env.TS_ENCRYPTION_KEY;
  });

  it('masks a url down to scheme and host', function () {
    expect(maskWebhookUrl('https://hooks.slack.com/services/T0/B0/secret?x=1')).to.equal('https://hooks.slack.com/…');
    expect(maskWebhookUrl('not a url')).to.equal('');
  });

  it('encrypts the url and the header values, and opens them again', function () {
    const url = 'https://hooks.slack.com/services/T0/B0/secret';
    const sealed = sealWebhookFields({url, headers: [{key: 'Authorization', value: 'Bearer abc'}]});
    expect(sealed.url.startsWith('v2:')).to.equal(true);
    expect(sealed.url).to.not.contain('secret');
    expect(sealed.urlDisplay).to.equal('https://hooks.slack.com/…');
    expect(sealed.headers[0].key).to.equal('Authorization');
    expect(sealed.headers[0].value.startsWith('v2:')).to.equal(true);

    // #48: a signing secret, stored encrypted and handed to the delivery only.
    expect(sealed.secret.startsWith('v2:')).to.equal(true);
    const secret = revealSigningSecret(sealed);
    expect(secret).to.match(/^[0-9a-f]{64}$/);

    const opened = openWebhookRow(Object.assign({_id: 'w1', name: 'Ops'}, sealed));
    expect(opened.signingSecret).to.equal(secret);
    expect(opened.secret).to.be.undefined;
    expect(opened.url).to.equal(url);
    expect(opened.headers).to.deep.equal([{key: 'Authorization', value: 'Bearer abc'}]);
    expect(opened.name).to.equal('Ops');
  });

  it('does not encrypt twice, and opens plaintext rows from before encryption as they are', function () {
    const once = sealWebhookFields({url: 'https://example.com/hook'});
    const twice = sealWebhookFields({url: once.url, secret: once.secret});
    expect(twice.url).to.equal(once.url);
    expect(twice.secret).to.equal(once.secret);
    expect(twice.urlDisplay).to.be.undefined;
    expect(openWebhookRow({url: 'https://example.com/plain', headers: [{key: 'X', value: 'y'}]}))
      .to.deep.equal({url: 'https://example.com/plain', headers: [{key: 'X', value: 'y'}]});
  });
});
