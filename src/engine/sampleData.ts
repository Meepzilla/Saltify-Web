import type { ClientInfo } from '../types/saltify';

export const DEMO_CLIENT_INFO: ClientInfo = {
  name: 'Client_042 (Sample)',
  age: '4;8',
  gender: 'M',
  dateOfBirth: '2022-03-14',
  dateOfSample: new Date().toISOString().slice(0, 10),
  examinerName: 'SLP Clinician',
  samplingContext: 'Narrative Retell (Picnic & Balloon Story)',
};

export const DEMO_TRANSCRIPT = `[0:00] E Tell me what happened in the story about the little boy.
[0:04] C Okay, it was a little boy that was going to the store.
[0:09] C He wanted to buy some cookies.
[0:13] C He took the bottom cookie box and then the other cookie boxes fell.
[0:19] C The man was mad and the little boy ran away.
[0:24] E What happened next with the dog and the rabbit?
[0:28] C Um there's a little bunny and a and a dog that's going to play in the sandbox.
[0:35] C The dog was building sand castles and the rabbit was putting sand in a bucket.
[0:42] C He walk to the picnic and he telled a funny story.
[0:48] C They was playing with a elephant balloon near the pool.
[0:54] C I I I goed to the park and my foots got wet.
[1:01] C Then the doctors were walking along and he gave money to the balloon man.
[1:08] C Now they were very happy and that's all.`;
