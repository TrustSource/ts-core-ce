const collectionUrl = (account) =>
  !account || account.match(/(https?:\/\/|\/)/) ? account : `https://${account}.visualstudio.com/defaultcollection`;

export default collectionUrl;
