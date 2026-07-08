// Broker — a per-user brokerage / custodian a holding is held AT (e.g.
// "Fidelity", "Wealthsimple", "Schwab"). Distinct from Company (the "held-by"
// owner entity) and from the stock's issuer (ticker + StockMetadata): a single
// position has an owner (companyId), an issuer (ticker), and a custodian
// (brokerId). Modelled as a managed list — mirroring Company — so "split by
// broker" groups on a stable ObjectId key instead of fragmenting on free-text
// spelling ("Fidelity" vs "fidelity").
import { Schema, model, models, Types, type Model } from 'mongoose';

export interface IBroker {
  userId: Types.ObjectId; // owner; indexed, required — never client-supplied
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const BrokerSchema = new Schema<IBroker>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
  },
  { timestamps: true, collection: 'brokers' },
);

// Indexes: scoped list by owner; one broker name per user (unique).
BrokerSchema.index({ userId: 1 });
BrokerSchema.index({ userId: 1, name: 1 }, { unique: true });

export const Broker: Model<IBroker> =
  (models.Broker as Model<IBroker>) ?? model<IBroker>('Broker', BrokerSchema);

export default Broker;
