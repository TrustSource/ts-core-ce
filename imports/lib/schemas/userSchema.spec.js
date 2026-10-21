
import {UserSchema} from './userSchema';
import {expect} from 'chai';

describe('UserSchema', function () {
  it('should report invalidKeys on validation', function () {

    // Every top-level UserSchema field is optional, so {} is valid. Use a
    // genuinely invalid document (createdAt must be a Date) so the schema
    // actually reports the invalid key.
    const obj = {createdAt: 'not-a-date'};

    const context = UserSchema.newContext();
    context.validate(obj);
    expect(context.isValid()).to.be.false;
    expect(context.keyIsInvalid('createdAt')).to.be.true;
  });

  it('should detect superflous properties and remove them with clean()', function () {
    const obj = {
      createdAt: new Date(),
      test: 'test'
    };
    const context = UserSchema.newContext();
    context.validate(obj);
    expect(context.isValid()).to.be.false;
    expect(context.keyIsInvalid('test')).to.be.true;

    UserSchema.clean(obj, {mutate: true});
    context.validate(obj);
    expect(context.isValid()).to.be.true;
  });

  it('should detect invalid email', function () {
    const obj = {
      username: 'User',
      createdAt: new Date(),
      emails: [{address: 'a@b@c', verified: false}]
    };

    const context = UserSchema.newContext();
    context.validate(obj);

    expect(context.isValid()).to.be.false;
    expect(context.validationErrors().length).to.be.equal(1);
    expect(context.keyIsInvalid('emails.0.address')).to.be.true;
    expect(context.validationErrors()[0].type).to.be.equal('regEx');
  });

  it('should validate fixture-user: "developer"', function () {
    const user = {
      'createdAt': new Date('2015-03-07T00:12:19.960Z'),
      'emails': [
        {
          'address': 'developer@example.com',
          'verified': true
        }
      ],
      'profile': {
        'name': 'Developer',
        'companyId': 'N9T8e9i9WrfNQWYbQ',
        'email': 'developer@example.com',
        'testuser': true
      },
      'services': {
        'password': {
          'bcrypt': '$2a$10$IgixCNIhV./NTdweZymBUeEsaNYryUXlr4WrtaOciDF1M4tP0Byc.'
        },
        'resume': {
          'loginTokens': [
            {
              'when': new Date('2015-03-07T22:32:08.788Z'),
              'hashedToken': 'xaoy3DhpKGGXF60YMwEzqJabPadywGp6uBOR0PxD6Fw='
            }
          ]
        }
      },
      'username': 'developer'
    };

    const context = UserSchema.newContext();
    context.validate(user);
    expect(context.validationErrors()).to.be.deep.equal([]);
  });

  it('should validate github user', function () {
    const user = {
      'createdAt': new Date('2015-03-08T20:13:11.905Z'),
      'profile': {
        'name': 'Jane Example',
        'companyId': 'bwat59Bn6cneY7SRi',
        'login': 'jane-example',
        'avatar_url': 'https://avatars.githubusercontent.com/u/1000001?v=3',
        'url': 'https://api.github.com/users/jane-example',
        'blog': null,
        'location': 'Germany',
        'email': 'jane@example.com',
        'html_url': 'https://github.com/jane-example'
      }, 'roles': {
        'bwat59Bn6cneY7SRi': ['manager']
      },
      'services': {
        'github': {
          'id': 1000001,
          'accessToken': '0000000000000000000000000000000000000000',
          'email': 'jane@example.com',
          'username': 'jane-example'
        },
        'resume': {
          'loginTokens': []
        }
      }
    };
    const context = UserSchema.newContext();
    context.validate(user);

    expect(context.isValid()).to.be.true;

  });
});
