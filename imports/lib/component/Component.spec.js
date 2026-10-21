
import {Meteor} from 'meteor/meteor';
import sinon from 'sinon';
import Component from './Component';
import QOS from './QOS';
import Components from '../collections/components';
import {expect} from 'chai';

const SHA1_SAMPLE = 'sha-1:1234567890'
const JUST_TEST = 'Just a test'
const HOMEPAGE1_SAMPLE = 'http://www.example.com'
const HOMEPAGE2_SAMPLE = 'http://www.example.net'

function buildComponentDoc() {
  return {
    key: 'mvn:test:component',
    name: 'testComponent',
    urls: {},
    created: new Date(),
    versions: [{
      version: '1.0.0',
      licenses: [{key: 'test', name: 'Test License', qos: 0},
        {key: 'test2', name: 'Test License2', qos: 2}],
      checksums: [{checksum: SHA1_SAMPLE, qos: 2}]
    }, {
      version: '2.0.0',
      licenses: [{key: 'test', name: 'Test License', qos: 0}],
      checksums: [{checksum: SHA1_SAMPLE, qos: 0}]
    }]
  };
}

// store() issues its Mongo writes as fire-and-forget (it returns `true` synchronously
// without awaiting updateAsync), so re-read the document until the write lands rather
// than sleeping. Each awaited read yields to the event loop, letting the pending write
// complete; the loop is bounded so a genuine failure still ends the test.
async function waitUntil(readFn, predicate, maxTries = 200) {
  for (let i = 0; i < maxTries; i++) {
    const value = await readFn();
    if (predicate(value)) {
      return value;
    }
  }
  return readFn();
}

describe('Component', function () {

  let component;

  beforeEach(function () {
    // The Components collection transform is `new Component(doc)`, so constructing the
    // instance directly is equivalent to `Components.findOne(id)` for the in-memory
    // model tests below - without a DB round trip (Meteor 3 server Mongo is async-only)
    // and working identically on client and server.
    component = new Component(buildComponentDoc());
  });

  it('empty object should not validate against Schema', function () {
    expect(new Component({}).validate().isValid()).to.be.false;
  });

  it('the test object should validate against Schema', function () {
    const context = component.validate();
    if (!context.isValid()) {
      // simple-schema v2 replaced invalidKeys() with validationErrors().
      console.log('Component invalid:', component.getName(), 'errors: ', context.validationErrors());
    }
    expect(context.isValid()).to.be.true;
  });

  describe('store()', function () {
    let callStub;

    beforeEach(function () {
      // store() fires Meteor.callAsync('logEvent' / 'ComponentLogs.Create') as
      // fire-and-forget side effects; those methods are not loaded in the unit-test app,
      // so stub the seam to keep the test off the network and free of unhandled rejections.
      callStub = sinon.stub(Meteor, 'callAsync').callsFake(function () {
        return Promise.resolve();
      });
    });

    afterEach(function () {
      callStub.restore();
    });

    if (Meteor.isServer) {
      it('should maintain "created" and "createdBy" and persist the object, if called on new object',
        async function () {
          const comp = new Component({name: 'TestComp', key: 'testKey'});
          comp.store('testUser');
          const now = new Date();
          // store() assigns the insertAsync() promise to data()._id on a new object.
          const insertedId = await comp.data()._id;
          try {
            const persistedComp = await Components.findOneAsync(insertedId);
            expect(persistedComp.getName()).to.be.equal('TestComp');
            // store() lower-cases the key of a newly created component.
            expect(persistedComp.getKey()).to.be.equal('testkey');
            expect(persistedComp.getUpdatedBy()).to.be.equal('testUser');
            expect(persistedComp.getUpdated().getTime())
              .to.be.within(now.getTime() - 2000, now.getTime() + 2000);
            expect(persistedComp.hasChanged()).to.be.false;
          } finally {
            await Components.removeAsync(insertedId);
          }
        });

      it('should maintain "updated" and "updatedBy" and persist the object, if called on existing object',
        async function () {
          const insertedId = await Components.insertAsync(buildComponentDoc());
          try {
            const existing = await Components.findOneAsync(insertedId);
            existing.setDescription(' a long text with blanks   ');
            existing.store('testUser');
            const now = new Date();
            const storedComp = await waitUntil(
              () => Components.findOneAsync(insertedId),
              (c) => !!c && c.getDescription() === 'a long text with blanks'
            );
            expect(storedComp.getDescription()).to.be.equal('a long text with blanks');
            expect(storedComp.getUpdatedBy()).to.be.equal('testUser');
            expect(storedComp.getUpdated().getTime())
              .to.be.within(now.getTime() - 2000, now.getTime() + 2000);
            expect(storedComp.hasChanged()).to.be.false;
          } finally {
            await Components.removeAsync(insertedId);
          }
        });
    }
  });

  describe('addLog()', function () {
    let callStub;

    afterEach(function () {
      if (callStub) {
        callStub.restore();
        callStub = undefined;
      }
    });

    it('should delegate log creation to the ComponentLogs.Create method', function () {
      // addLog() now records into the ComponentLogs collection via a Meteor method
      // instead of pushing onto component.data().logs. Stub the method seam and assert
      // the delegation. The call is guarded by the component id; the current
      // implementation reads this._id (see Notes: suspected bug, it should read
      // this.data()._id), so set both to the same value to exercise the path.
      callStub = sinon.stub(Meteor, 'callAsync').callsFake(function () {
        return Promise.resolve();
      });
      const id = 'SJXjPiAobAE4rSJpH';
      component._id = id;
      component.data()._id = id;

      component.addLog('testUser', '1.0.0', 'test entry');

      expect(callStub.calledOnce).to.be.true;
      expect(callStub.firstCall.args[0]).to.be.equal('ComponentLogs.Create');
      const payload = callStub.firstCall.args[1];
      expect(payload.componentKey).to.be.equal('mvn:test:component');
      expect(payload.componentId).to.be.equal(id);
      expect(payload.version).to.be.equal('1.0.0');
      expect(payload.text).to.be.equal('test entry');
      expect(component.hasChanged()).to.be.true;
    });
  });

  describe('setUrl()', function () {
    it('should set url entry only once if argument "overide" is not true', function () {
      expect(component.data().urls.homepage).to.be.undefined;
      component.setUrl('homepage', HOMEPAGE1_SAMPLE);
      expect(component.data().urls.homepage).to.be.equal(HOMEPAGE1_SAMPLE);
      expect(component.hasChanged()).to.be.true;

      component.setUrl('homepage', HOMEPAGE2_SAMPLE);
      expect(component.data().urls.homepage).to.be.equal(HOMEPAGE1_SAMPLE);
    });

    it('should override exisiting url if argument "overide" is true', function () {
      expect(component.getUrl('homepage')).to.be.undefined;
      component.setUrl('homepage', HOMEPAGE1_SAMPLE);
      expect(component.getUrl('homepage')).to.be.equal(HOMEPAGE1_SAMPLE);

      component.setUrl('homepage', HOMEPAGE2_SAMPLE, true);
      expect(component.getUrl('homepage')).to.be.equal(HOMEPAGE2_SAMPLE);
    });
  });

  describe('setDescription()', function () {
    it('should purge leading and trailing blanks and only override existing description if argument "overide" is true',
      function () {
        expect(component.getDescription()).to.be.undefined;
        component.setDescription(JUST_TEST);
        expect(component.getDescription()).to.be.equal(JUST_TEST);
        expect(component.hasChanged()).to.be.true;

        component.setDescription(' no overwrite expected ');
        expect(component.getDescription()).to.be.equal(JUST_TEST);

        component.setDescription(' overwrite expected ', true);
        expect(component.getDescription()).to.be.equal('overwrite expected');
      });
  });

  describe('findVersion()', function () {
    it('should return undefined if version-string not found in component', function () {
      expect(component.findVersion('1.0.1')).to.be.undefined;
    });

    it('should return instance of Version if version-string is found in component', function () {
      expect(component.findVersion('1.0.0')).to.exist;
    });
  });

  describe('Version', function () {
    let version;
    beforeEach(function () {
      version = component.getVersion('1.0.0');
    });

    describe('hasValidatedLicense()', function () {
      it('should report a validated license', function () {
        expect(version.hasValidatedLicense()).to.be.true;
      });

      it('should report a license not validated yet()', function () {
        expect(component.getVersion('2.0.0').hasValidatedLicense()).to.be.false;
      });
    });

    describe('License', function () {
      let license;
      beforeEach(function () {
        license = version.getLicense('test');
      });

      describe('setQos()', function () {
        it('should be able to set Qos as literal and as string and get Qos as string', function () {
          expect(license.data().qos).to.be.equal(0);
          expect(license.getQos()).to.be.equal(0);
          expect(license.getQosStr()).to.be.equal('NOT_CHECKED');

          license.setQos(QOS.PACKAGE_META);
          expect(license.data().qos).to.be.equal(1);
          expect(license.getQos()).to.be.equal(1);
          expect(license.getQosStr()).to.be.equal('PACKAGE_META');

          expect(component.hasChanged()).to.be.true;
        });
      });
    });

    describe('Checksum', function () {
      let checksum;
      beforeEach(function () {
        checksum = version.getChecksum(SHA1_SAMPLE);
      });

      describe('findChecksum()', function () {
        it('should search by algorithm only (finished with first colon)', function () {
          checksum = version.findChecksum('sha-1:abc');
          expect(checksum).to.exist;
          expect(checksum.data().checksum).to.be.equal(SHA1_SAMPLE);
        });
      });

      describe('setQos()', function () {
        it('should be able to set Qos as literal and as string and get Qos as string', function () {
          expect(checksum.data().qos).to.be.equal(2);
          expect(checksum.getQos()).to.be.equal(2);
          expect(checksum.getQosStr()).to.be.equal('REPO_CRAWLER');

          checksum.setQos(QOS.PACKAGE_META);
          expect(checksum.data().qos).to.be.equal(1);
          expect(checksum.getQos()).to.be.equal(1);
          expect(checksum.getQosStr()).to.be.equal('PACKAGE_META');

          expect(component.hasChanged()).to.be.true;
        });
      });
    });
  });
});
