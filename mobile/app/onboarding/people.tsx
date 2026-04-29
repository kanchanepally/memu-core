import ConversationalStep from '../../components/ConversationalStep';

export default function PeopleStep() {
  return (
    <ConversationalStep
      step="people"
      nextRoute="/onboarding/rhythm"
      stepNumber={1}
    />
  );
}
