import {Meteor} from 'meteor/meteor';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {Config} from '/imports/config';
import {resolveStoragePath} from '/imports/server/storage/storagePaths';

// Local file storage for the Community Edition. The root is
// METEOR_UPLOAD_FOLDER, which production mounts as a Docker volume that several app
// containers may share. Every reference goes through the path guard, so nothing
// outside <root>/<companyId>/<folder>/<name> is ever read or written.

function filePath({companyId, folder, name}) {
  const resolved = resolveStoragePath(Config.METEOR_UPLOAD_FOLDER, companyId, folder, name);
  if (!resolved) {
    throw new Meteor.Error(400, 'Invalid file reference');
  }
  return resolved;
}

function isMissing(error) {
  return !!error && error.code === 'ENOENT';
}

// Written to a temp file next to the target and renamed into place, so a reader on
// the shared volume sees the old file or the new one, never half of one.
export async function putFile({companyId, folder, name, data}) {
  const target = filePath({companyId, folder, name});
  await fs.promises.mkdir(path.dirname(target), {recursive: true});
  const temp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    await fs.promises.writeFile(temp, data);
    await fs.promises.rename(temp, target);
  } catch (error) {
    await fs.promises.rm(temp, {force: true});
    throw error;
  }
}

export async function readBuffer(ref) {
  const target = filePath(ref);
  try {
    return await fs.promises.readFile(target);
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

export async function readJson(ref) {
  const buffer = await readBuffer(ref);
  if (!buffer) {
    return null;
  }
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    console.error('fileStorage.readJson: invalid JSON in', `${ref.folder}/${ref.name}`, error.message);
    return null;
  }
}

export async function removeFile(ref) {
  await fs.promises.rm(filePath(ref), {force: true});
}

export async function statFile(ref) {
  const target = filePath(ref);
  try {
    const stats = await fs.promises.stat(target);
    return stats.isFile() ? stats : null;
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

export function openReadStream(ref) {
  return fs.createReadStream(filePath(ref));
}
