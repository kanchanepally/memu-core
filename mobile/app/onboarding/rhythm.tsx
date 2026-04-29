import ConversationalStep from '../../components/ConversationalStep';

export default function RhythmStep() {
  return (
    <ConversationalStep
      step="rhythm"
      nextRoute="/onboarding/focus"
      stepNumber={2}
    />
  );
}
