import { InvalidAgentDefinitionError } from '@chamvi/app';
import { hashSkillBundle, loadSkillBundles, prepareSkills } from '@chamvi/skills';
import type { PrepareSkillsOptions, PreparedSkill } from '@chamvi/skills';

// Call in an explicit setup/build task, with separately reviewed pins from app configuration.
export async function prepareCatalog(options: Omit<PrepareSkillsOptions, 'verify'>, pins: Readonly<Record<string, string>>) {
    const prepared: readonly PreparedSkill[] = await prepareSkills({
        ...options,
        verify(skill) {
            if (hashSkillBundle(skill.path) !== pins[skill.name]) {
                throw new InvalidAgentDefinitionError('Skill content does not match the reviewed pin.');
            }
        },
    });
    return loadSkillBundles(prepared.map((skill) => ({
        name: skill.name,
        directory: skill.path,
        version: options.revision,
        sha256: pins[skill.name]!,
    })));
}
