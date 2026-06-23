import ProgrammerScreen from './ProgrammerScreen';
import { programmerFixtures } from './fixtures';

/** Standalone visual preview of the programmer screen. */
export default function ProgrammerScreenPreview() {
  return <ProgrammerScreen {...programmerFixtures} />;
}
