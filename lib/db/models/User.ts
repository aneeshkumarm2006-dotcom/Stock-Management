// User — per-user account. Refs: PDR.md §6 (User), Tech_Stack.md §Database.
import { Schema, model, models, type Model } from 'mongoose';

export interface IUser {
  email: string;
  name: string;
  passwordHash?: string; // bcrypt; absent for Google-only accounts
  image?: string; // avatar from Google
  emailVerified?: Date | null; // set for Google sign-ins
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String },
    image: { type: String },
    emailVerified: { type: Date, default: null },
  },
  { timestamps: true, collection: 'users' },
);

// Index: users { email: 1 } unique.
UserSchema.index({ email: 1 }, { unique: true });

export const User: Model<IUser> =
  (models.User as Model<IUser>) ?? model<IUser>('User', UserSchema);

export default User;
