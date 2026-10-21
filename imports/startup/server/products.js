import {Meteor} from 'meteor/meteor';
import {
  ProductsCreate, ProductsRemove, ProductsUpdate, ProductsRemoveRevert,
  ProductsImport, ProductsExport, ProductsRemoveDrafts, ProductsLinkWithRelease,
  ProductsUnlinkWithRelease, ProductsSupportCreate, ProductsPictureRemove,
  ProductsSupportRemove, ProductsMisuseCreate, ProductsMisuseRemove, ProductsPictureUpload,
  ProductsDocumentUpload, ProductsDocumentRemove, ProductsSBOMGenerate
} from '/imports/lib/interactors/products';
import {requireLogin} from '/imports/server/security/methodGuards';
import {buildProductFilesArchive} from '/imports/server/storage/productFiles';

Meteor.methods({
  'Products.Create': ProductsCreate,
  'Products.Remove': ProductsRemove,
  'Products.RemoveDrafts': ProductsRemoveDrafts,
  'Products.RemoveRevert': ProductsRemoveRevert,
  'Products.Update': ProductsUpdate,
  'Products.Import': ProductsImport,
  'Products.Export': ProductsExport,
  'Products.LinkWithRelease': ProductsLinkWithRelease,
  'Products.UnlinkWithRelease': ProductsUnlinkWithRelease,
  'Products.SupportCreate': ProductsSupportCreate,
  'Products.SupportRemove': ProductsSupportRemove,
  'Products.MisuseCreate': ProductsMisuseCreate,
  'Products.MisuseRemove': ProductsMisuseRemove,
  'Products.PictureUpload': ProductsPictureUpload,
  'Products.PictureRemove': ProductsPictureRemove,
  'Products.DocumentUpload': ProductsDocumentUpload,
  'Products.DocumentRemove': ProductsDocumentRemove,
  'Products.SBOMGenerate': ProductsSBOMGenerate,
  'Products.DownloadArchive': async function (params) {
    requireLogin(this);
    const user = await Meteor.userAsync();
    const companyId = user && user.profile && user.profile.companyId;
    return await buildProductFilesArchive({companyId, fileUrls: params && params.fileUrls});
  }
});
