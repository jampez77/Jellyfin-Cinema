import { providerBrands } from './provider-brands';
import { defaultProviderConfig } from './provider-settings';
import type { ProviderDirectory } from './types';

export type ProviderSourceKey = 'movieProviderIds' | 'showProviderIds';
export type ProviderServiceChoice = { key: string; name: string; ids: number[] };

/** Preset mappings are already verified; keep their variants together until
 * the server can supply the current individual catalogue names. */
export function providerServiceChoices(directory: ProviderDirectory | undefined, key: ProviderSourceKey, selected: number[]): ProviderServiceChoice[] {
  const presets = providerBrands.map(brand => ({ key: `preset:${brand.id}`, name: brand.name, ids: defaultProviderConfig(brand.id)[key] }));
  const choices: ProviderServiceChoice[] = directory
    ? (key === 'movieProviderIds' ? directory.Movies : directory.Shows).map(service => ({ key: `service:${service.Id}`, name: service.Name, ids: [service.Id] }))
    : presets;
  const known = new Set(choices.flatMap(choice => choice.ids));
  const missing = selected.filter(id => !known.has(id));
  const remaining = new Set(missing);
  for (const preset of presets) {
    const ids = preset.ids.filter(id => remaining.has(id));
    if (ids.length) choices.push({ key: `${preset.key}:saved`, name: `${preset.name} (saved catalogue)`, ids });
    ids.forEach(id => remaining.delete(id));
  }
  for (const [index, id] of [...remaining].entries()) {
    choices.push({ key: `service:${id}`, name: `Previously selected service${remaining.size > 1 ? ` ${index + 1}` : ''}`, ids: [id] });
  }
  return choices.sort((a, b) => a.name.localeCompare(b.name));
}
