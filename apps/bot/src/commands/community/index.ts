import { sticky } from './sticky.js';
import { suggest, suggestReview } from './suggest.js';
import { appeal } from './appeal.js';
import { invites } from './invites.js';
import { autoReaction } from './auto-reaction.js';
import { quote } from './quote.js';
import { saveQuoteContext } from './quote-context.js';
import { milestone } from './milestone.js';

export const communityCommands = [sticky, suggest, suggestReview, appeal, invites, autoReaction, quote, milestone];
export const communityContextCommands = [saveQuoteContext];
