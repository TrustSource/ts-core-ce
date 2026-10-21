import {Mongo} from 'meteor/mongo';
import {TaskSchema} from '../schemas/taskSchema';

const Tasks = new Mongo.Collection('tasks');

Tasks.attachSchema(TaskSchema);

export default Tasks;


