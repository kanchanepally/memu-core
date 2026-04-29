import ConversationalStep from '../../components/ConversationalStep';

export default function FocusStep() {
  return (
    <ConversationalStep
      step="focus"
      nextRoute="/onboarding/preview"
      stepNumber={3}
    />
  );
}
