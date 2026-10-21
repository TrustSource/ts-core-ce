import ApprovalReports from '/imports/lib/collections/approvalReports';

const saveReports = async function ({approveId, companyId, type, data, demo}) {
  let doc = {
    created: new Date(),
    companyId,
    approveId,
    type,
    data: data,
    demo
  };
  return await ApprovalReports.insertAsync(doc)
};

export default saveReports;
