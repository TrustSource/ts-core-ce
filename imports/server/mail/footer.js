import {Config as AppConfig} from '/imports/config';
import {Config} from '/imports/server/config';
import {buildMailFooter, buildSupportContact} from './footerHtml';

// The footer appended to every mail the app sends: the app, its address and the
// operator details set in the environment.
export function mailFooter() {
  return buildMailFooter({
    appName: AppConfig.name,
    appUrl: AppConfig.appUrl,
    operatorName: Config.TS_OPERATOR_NAME,
    supportEmail: Config.TS_SUPPORT_EMAIL,
    imprintUrl: Config.TS_IMPRINT_URL
  });
}

// Whom a recipient who did not ask for a mail should contact.
export function supportContact() {
  return buildSupportContact(Config.TS_SUPPORT_EMAIL);
}
