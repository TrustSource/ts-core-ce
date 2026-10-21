import {Meteor} from 'meteor/meteor';

// Who a write acts as.
//
// Several interactors took the acting user from their arguments
// (`params.user`, `authOptions.user`, `apiUser`, `userData`), which let a client
// name another company's user and write into that tenant - a live check wrote
// into, and read Products out of, a company the caller did not belong to. A call arriving over a client DDP connection (`context.connection` set)
// must act as the authenticated session user, never a user object from the
// arguments. A server or internal call - the REST layer, or a nested interactor
// call, both with no connection - trusts the user it was handed.
//
// `context` is the Meteor method invocation (`this`); it is undefined when an
// interactor is called as a plain function from another interactor, which is a
// trusted server path.
export async function resolveActingUser(context, suppliedUser) {
  if (context && context.connection) {
    if (!context.userId) {
      throw new Meteor.Error(403, 'Access Denied');
    }
    return await Meteor.users.findOneAsync(context.userId);
  }
  return suppliedUser || await Meteor.userAsync();
}
