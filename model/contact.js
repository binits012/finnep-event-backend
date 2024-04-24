import * as model from '../model/mongoModel.js'; // Assuming Contact model is exported within model
import { createHashData, readHash, updateHash, deleteHashById } from '../util/createHash.js';
import { error} from './logger.js'; // Assuming logger exports a log function


export class Contact {
  constructor(streetName, user, crypto) {
    this.streetName = streetName;
    this.user = user;
    this.crypto = crypto;
  }

  async saveToDB() {
    try {
      const contact = new model.Contact({
        streetName: this.streetName,
        user: this.user,
        crypto: this.crypto,
      });
      return await contact.save();
    } catch (err) {
      error('Error saving contact:', err);
      throw err; // Re-throw the error for further handling
    }
  }
}

export async function createContact(streetName, phone, email, user) {
  try {
    const emailHash = await createHashData(email, 'email');
    const phoneHash = await createHashData(phone, 'phone');
    const tempCrypto = [emailHash, phoneHash];
    const contact = new model.Contact({
      streetName,
      user,
      crypto: tempCrypto,
    });
    return await contact.saveToDB();
  } catch (err) {
    error(  'Error creating contact:', err);
    throw err; // Re-throw the error for further handling
  }
}

// Get contact by ID function (assuming model points to Contact model)
export async function getContactById(userId) {
  try {
    const contact = await model.Contact.findOne({ user: userId }).populate('user').exec();

    if (!contact) {
      return null;
    }

    const [data1, data2] = await Promise.all([
      readHash(contact.crypto[0]).catch((err) => {
        error( 'Error reading hash:', err);
        return null; // Return null or handle error differently
      }),
      readHash(contact.crypto[1]).catch((err) => {
        error( 'Error reading hash:', err);
        return null; // Handle error differently
      }),
    ]);

    const data = {
      _id: contact.id,
      user: {
        _id: contact.user.id,
        name: contact.user.name,
        role: contact.user.role,
        active: contact.user.active,
      },
      contact: [data1, data2],
      streetName: contact.streetName,
    };

    return data;
  } catch (err) {
    error( 'Error getting contact by ID:', err);
    throw err; // Re-throw the error for further handling
  }
}

// Update contact by ID function (assuming model points to Contact model)
export async function updateContactById(id, streetName, emailId, email, phoneId, phone) {
  try {
    const emailUpdate = await updateHash(emailId, email);
    const phoneUpdate = await updateHash(phoneId, phone);
    const tempCrypto = [emailUpdate, phoneUpdate];

    const updatedContact = await model.Contact.findByIdAndUpdate(id, {
      $set: {
        streetName,
        crypto: tempCrypto,
      },
    }, { new: true });

    return updatedContact;
  } catch (err) {
    error( 'Error updating contact by ID:', err);
    throw err; // Re-throw the error for further handling
  }
}

export async function deleteContactById(id, emailId, phoneId) {
	try {
	  await deleteHashById(emailId);
	  await deleteHashById(phoneId);
	  await model.Contact.deleteOne({ _id: id });
	} catch (err) {
	  error( 'Error deleting contact by ID:', err);
	  throw err; // Re-throw the error for further handling
	}
  }


  