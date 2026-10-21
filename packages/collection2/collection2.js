import { EventEmitter } from 'meteor/raix:eventemitter';

// Exported only for listening to events
Collection2 = new EventEmitter();

// Eagerly load attachSchema (was lazy in upstream 4.1.5)
import './main';

export default Collection2;