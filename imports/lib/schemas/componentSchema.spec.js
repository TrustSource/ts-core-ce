
import {ComponentSchema} from './componentSchema';
import {expect} from 'chai';

describe('ComponentSchema', function () {
  it('should validate sample Component', function () {

    const component = {
      _id: 'XJSjPiAobBE4rSJpH',
      name: 'test component',
      key: 'mvn:keine.ahnung.aber.eine.lange.group:auch.dass.ist.lang',
      urls: {
        homepage: 'http://www.example.com',
        repository: 'git://www.example.com/repo.git'
      },
      created: new Date(),
      versions: [{
        version: '1.0.0-SNAPSHOT',
        licenses: [{
          key: 'do-what-you-want',
          name: 'Mach was du willst, aber lass mich mit Fragen in Ruhe',
          qos: 0
        }]
      }, {
        version: '1.0.1',
        licenses: [{
          key: 'commercial',
          name: 'Commercial des kost was',
          qos: 2
        }]
      },
      {
        version: '2.0',
        licenses: [{
          key: 'commercial',
          name: 'Commercial des kost was',
          qos: 3
        }],
        checksums: [{checksum: 'sha-1:abcde', qos: 1}, {checksum: 'md-5:fhaehakuhk', qos: 2}]
      }]
    };

    const context = ComponentSchema.newContext();
    context.validate(component);

    if (!context.isValid()) {
      console.log('Component-validation-context:', context.validationErrors());
    }

    expect(context.isValid()).to.be.true;
  });
});
