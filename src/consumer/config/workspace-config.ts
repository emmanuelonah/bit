import { pickBy } from 'lodash';
import R from 'ramda';
import { DEFAULT_COMPONENTS_DIR_PATH, DEFAULT_DEPENDENCIES_DIR_PATH, DEFAULT_PACKAGE_MANAGER } from '../../constants';
import { PathOsBased, PathOsBasedAbsolute } from '../../utils/path';
import AbstractConfig from './abstract-config';
import { InvalidPackageJson } from './exceptions';
import InvalidPackageManager from './exceptions/invalid-package-manager';
import { ExtensionDataList } from './extension-data';
import { ILegacyWorkspaceConfig, PackageManagerClients } from './legacy-workspace-config-interface';

const DEFAULT_USE_WORKSPACES = false;
const DEFAULT_MANAGE_WORKSPACES = true;

export type WorkspaceConfigIsExistFunction = (dirPath: string | PathOsBased) => Promise<boolean | undefined>;

export type WorkspaceConfigLoadFunction = (
  workspacePath: string | PathOsBased,
  scopePath: PathOsBasedAbsolute
) => Promise<ILegacyWorkspaceConfig | undefined>;

export type WorkspaceConfigEnsureFunction = (
  workspacePath: PathOsBasedAbsolute,
  scopePath: PathOsBasedAbsolute,
  standAlone: boolean,
  workspaceConfigProps: WorkspaceConfigProps
) => Promise<ILegacyWorkspaceConfig>;

export type WorkspaceConfigResetFunction = (dirPath: PathOsBasedAbsolute, resetHard: boolean) => Promise<void>;

export type WorkspaceConfigProps = {
  lang?: string;
  componentsDefaultDirectory?: string;
  dependenciesDirectory?: string;
  extensions?: ExtensionDataList;
  packageManager?: PackageManagerClients;
  packageManagerArgs?: string[];
  packageManagerProcessOptions?: Record<string, any>;
  useWorkspaces?: boolean;
  manageWorkspaces?: boolean;
  defaultScope?: string;
};

export default class WorkspaceConfig extends AbstractConfig {
  componentsDefaultDirectory: string;
  dependenciesDirectory: string;
  packageManager: PackageManagerClients;
  packageManagerArgs: string[] | undefined; // package manager client to use
  packageManagerProcessOptions: Record<string, any> | undefined; // package manager process options
  useWorkspaces: boolean; // Enables integration with Yarn Workspaces
  manageWorkspaces: boolean; // manage workspaces with yarn
  packageJsonObject: Record<string, any> | null | undefined; // workspace package.json if exists (parsed)
  defaultScope: string | undefined; // default remote scope to export to

  static workspaceConfigIsExistRegistry: WorkspaceConfigIsExistFunction;
  static registerOnWorkspaceConfigIsExist(func: WorkspaceConfigIsExistFunction) {
    this.workspaceConfigIsExistRegistry = func;
  }

  static workspaceConfigLoadingRegistry: WorkspaceConfigLoadFunction;
  static registerOnWorkspaceConfigLoading(func: WorkspaceConfigLoadFunction) {
    this.workspaceConfigLoadingRegistry = func;
  }
  static workspaceConfigEnsuringRegistry: WorkspaceConfigEnsureFunction;
  static registerOnWorkspaceConfigEnsuring(func: WorkspaceConfigEnsureFunction) {
    this.workspaceConfigEnsuringRegistry = func;
  }
  static workspaceConfigResetRegistry: WorkspaceConfigResetFunction;
  static registerOnWorkspaceConfigReset(func: WorkspaceConfigResetFunction) {
    this.workspaceConfigResetRegistry = func;
  }

  constructor({
    lang,
    componentsDefaultDirectory = DEFAULT_COMPONENTS_DIR_PATH,
    dependenciesDirectory = DEFAULT_DEPENDENCIES_DIR_PATH,
    extensions,
    packageManager = DEFAULT_PACKAGE_MANAGER,
    packageManagerArgs,
    packageManagerProcessOptions,
    useWorkspaces = DEFAULT_USE_WORKSPACES,
    manageWorkspaces = DEFAULT_MANAGE_WORKSPACES,
    defaultScope,
  }: WorkspaceConfigProps) {
    super({ lang, extensions });
    if (packageManager !== 'npm' && packageManager !== 'yarn') {
      throw new InvalidPackageManager(packageManager);
    }
    this.componentsDefaultDirectory = componentsDefaultDirectory;
    // Make sure we have the component name in the path. otherwise components will be imported to the same dir.
    if (!componentsDefaultDirectory.includes('{name}')) {
      this.componentsDefaultDirectory = `${this.componentsDefaultDirectory}/{name}`;
    }
    this.dependenciesDirectory = dependenciesDirectory;
    this.packageManager = packageManager;
    this.packageManagerArgs = packageManagerArgs;
    this.packageManagerProcessOptions = packageManagerProcessOptions;
    this.useWorkspaces = useWorkspaces;
    this.manageWorkspaces = manageWorkspaces;
    this.defaultScope = defaultScope;
  }

  toPlainObject() {
    const superObject = super.toPlainObject();
    const consumerObject = {
      ...superObject,
      componentsDefaultDirectory: this.componentsDefaultDirectory,
      dependenciesDirectory: this.dependenciesDirectory,
      packageManager: this.packageManager,
      packageManagerArgs: this.packageManagerArgs,
      packageManagerProcessOptions: this.packageManagerProcessOptions,
      useWorkspaces: this.useWorkspaces,
      manageWorkspaces: this.manageWorkspaces,
      defaultScope: this.defaultScope,
    };

    const isPropDefault = (val, key) => {
      if (key === 'dependenciesDirectory') return val !== DEFAULT_DEPENDENCIES_DIR_PATH;
      if (key === 'useWorkspaces') return val !== DEFAULT_USE_WORKSPACES;
      if (key === 'manageWorkspaces') return val !== DEFAULT_MANAGE_WORKSPACES;
      if (key === 'resolveModules') return !R.isEmpty(val);
      if (key === 'defaultScope') return Boolean(val);
      return true;
    };

    return pickBy(consumerObject, isPropDefault);
  }

  static create(workspaceConfigProps: WorkspaceConfigProps): WorkspaceConfig {
    return new WorkspaceConfig(workspaceConfigProps);
  }

  static async ensure(
    workspacePath: PathOsBasedAbsolute,
    scopePath: PathOsBasedAbsolute,
    standAlone = false,
    workspaceConfigProps: WorkspaceConfigProps = {} as any
  ): Promise<ILegacyWorkspaceConfig> {
    const ensureFunc = this.workspaceConfigEnsuringRegistry;
    return ensureFunc(workspacePath, scopePath, standAlone, workspaceConfigProps);
  }

  static async reset(
    workspacePath: PathOsBasedAbsolute,
    scopePath: PathOsBasedAbsolute,
    resetHard: boolean
  ): Promise<void> {
    const resetFunc = this.workspaceConfigResetRegistry;
    await resetFunc(workspacePath, resetHard);
    await WorkspaceConfig.ensure(workspacePath, scopePath);
  }

  static async loadIfExist(
    dirPath: string | PathOsBased,
    scopePath: PathOsBasedAbsolute
  ): Promise<ILegacyWorkspaceConfig | undefined> {
    const loadFunc = this.workspaceConfigLoadingRegistry;
    if (loadFunc && typeof loadFunc === 'function') {
      return loadFunc(dirPath, scopePath);
    }
    return undefined;
  }

  static async isExist(dirPath: string): Promise<boolean | undefined> {
    const isExistFunc = this.workspaceConfigIsExistRegistry;
    if (isExistFunc && typeof isExistFunc === 'function') {
      return isExistFunc(dirPath);
    }
    return undefined;
  }

  static async _isExist(dirPath: string): Promise<boolean> {
    const packageJsonPath = AbstractConfig.composePackageJsonPath(dirPath);
    const packageJson = await this.loadPackageJson(packageJsonPath);
    if (packageJson && packageJson.bit) {
      return true;
    }
    return false;
  }

  static async loadPackageJson(packageJsonPath: string): Promise<Record<string, any> | null | undefined> {
    try {
      const file = await AbstractConfig.loadJsonFileIfExist(packageJsonPath);
      return file;
    } catch (e: any) {
      throw new InvalidPackageJson(packageJsonPath);
    }
  }
}
