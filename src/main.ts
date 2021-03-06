import * as child_process from 'child_process';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as log from './log';
import {GraphicsApi} from './GraphicsApi';
import {Options} from './Options';
import {Project} from './Project';
import {Platform} from './Platform';
import * as exec from './exec';
import {VisualStudioVersion} from './VisualStudioVersion';
import {Exporter} from './Exporters/Exporter';
import {AndroidExporter} from './Exporters/AndroidExporter';
import {LinuxExporter} from './Exporters/LinuxExporter';
import {EmscriptenExporter} from './Exporters/EmscriptenExporter';
import {TizenExporter} from './Exporters/TizenExporter';
import {VisualStudioExporter} from './Exporters/VisualStudioExporter';
import {XCodeExporter} from './Exporters/XCodeExporter';

let debug = false;

function fromPlatform(platform: string): string {
	switch (platform) {
		case Platform.Windows:
			return 'Windows';
		case Platform.WindowsApp:
			return 'Windows App';
		case Platform.PlayStation3:
			return 'PlayStation 3';
		case Platform.iOS:
			return 'iOS';
		case Platform.OSX:
			return 'OS X';
		case Platform.Android:
			return 'Android';
		case Platform.Xbox360:
			return 'Xbox 360';
		case Platform.Linux:
			return 'Linux';
		case Platform.HTML5:
			return 'HTML5';
		case Platform.Tizen:
			return 'Tizen';
		case Platform.Pi:
			return 'Pi';
		case Platform.tvOS:
			return 'tvOS';
		default:
			return 'unknown';
	}
}

function shaderLang(platform: string): string {
	switch (platform) {
		case Platform.Windows:
			switch (Options.graphicsApi) {
				case GraphicsApi.OpenGL:
				case GraphicsApi.OpenGL2:
					return 'glsl';
				case GraphicsApi.Direct3D9:
					return 'd3d9';
				case GraphicsApi.Direct3D11:
					return 'd3d11';
				case GraphicsApi.Direct3D12:
					return 'd3d11';
				case GraphicsApi.Vulkan:
					return 'spirv';
				default:
					return 'd3d9';
			}
		case Platform.WindowsApp:
			return 'd3d11';
		case Platform.PlayStation3:
			return 'd3d9';
		case Platform.iOS:
		case Platform.tvOS:
			switch (Options.graphicsApi) {
				case GraphicsApi.Metal:
					return 'metal';
				default:
					return 'essl';
			}
		case Platform.OSX:
			switch (Options.graphicsApi) {
				case GraphicsApi.Metal:
					return 'metal';
				default:
					return 'glsl';
			}
		case Platform.Android:
			switch (Options.graphicsApi) {
				case GraphicsApi.Vulkan:
					return 'spirv';
				default:
					return 'essl';
			}
		case Platform.Xbox360:
			return 'd3d9';
		case Platform.Linux:
			switch (Options.graphicsApi) {
				case GraphicsApi.Vulkan:
					return 'spirv';
				default:
					return 'glsl';
			}
		case Platform.HTML5:
			return 'essl';
		case Platform.Tizen:
			return 'essl';
		case Platform.Pi:
			return 'essl';
		default:
			return platform;
	}
}

async function compileShader(projectDir: string, type: string, from: string, to: string, temp: string, platform: string) {
	return new Promise<void>((resolve, reject) => {
		let compilerPath = '';
		
		if (Project.koreDir !== '') {
			compilerPath = path.resolve(Project.koreDir, 'Tools', 'krafix', 'krafix' + exec.sys());
		}

		if (fs.existsSync(path.join(projectDir, 'Backends'))) {
			let libdirs = fs.readdirSync(path.join(projectDir, 'Backends'));
			for (let ld in libdirs) {
				let libdir = path.join(projectDir, 'Backends', libdirs[ld]);
				if (fs.statSync(libdir).isDirectory()) {
					let exe = path.join(libdir, 'krafix', 'krafix-' + platform + '.exe');
					if (fs.existsSync(exe)) {
						compilerPath = exe;
					}
				}
			}
		}

		if (compilerPath !== '') {
			let params = [type, from, to, temp, platform];
			if (debug) params.push('--debug');
			let compiler = child_process.spawn(compilerPath, params);
			
			compiler.stdout.on('data', (data: any) => {
				log.info(data.toString());
			});

			let errorLine = '';
			let newErrorLine = true;
			let errorData = false;
			
			function parseData(data: string) {

			}

			compiler.stderr.on('data', (data: any) => {
				let str: string = data.toString();
				for (let char of str) {
					if (char === '\n') {
						if (errorData) {
							parseData(errorLine.trim());
						}
						else {
							log.error(errorLine.trim());
						}
						errorLine = '';
						newErrorLine = true;
						errorData = false;
					}
					else if (newErrorLine && char === '#') {
						errorData = true;
						newErrorLine = false;
					}
					else {
						errorLine += char;
						newErrorLine = false;
					}
				}
			});

			compiler.on('close', (code: number) => {
				if (code === 0) {
					resolve();
				}
				else {
					// process.exitCode = 1;
					reject('Shader compiler error.');
				}
			});
		}
		else {
			throw 'Could not find shader compiler.';
		}
	});
}

async function exportKoremakeProject(from: string, to: string, platform: string, options: any) {
	log.info('korefile found.');
	log.info('Creating ' + fromPlatform(platform) + ' project files.');

	let project: Project;
	try {
		project = await Project.create(from, platform);
		project.searchFiles(undefined);
		project.flatten();
	}
	catch (error) {
		log.error(error);
		throw error;
	}

	fs.ensureDirSync(to);

	let files = project.getFiles();
	if (!options.noshaders) {
		let shaderCount = 0;
		for (let file of files) {
			if (file.file.endsWith('.glsl')) {
				++shaderCount;
			}
		}
		let shaderIndex = 0;
		for (let file of files) {
			if (file.file.endsWith('.glsl')) {
				let outfile = file.file;
				const index = outfile.lastIndexOf('/');
				if (index > 0) outfile = outfile.substr(index);
				outfile = outfile.substr(0, outfile.length - 5);

				let parsedFile = path.parse(file.file);
				log.info('Compiling shader ' + (shaderIndex + 1) + ' of ' + shaderCount + ' (' + parsedFile.name + ').');
				
				++shaderIndex;
				await compileShader(from, shaderLang(platform), file.file, path.join(project.getDebugDir(), outfile), 'build', platform);
			}
		}
	}

	let exporter: Exporter = null;
	if (platform === Platform.iOS || platform === Platform.OSX || platform === Platform.tvOS) exporter = new XCodeExporter();
	else if (platform === Platform.Android) exporter = new AndroidExporter();
	else if (platform === Platform.HTML5) exporter = new EmscriptenExporter();
	else if (platform === Platform.Linux || platform === Platform.Pi) exporter = new LinuxExporter();
	else if (platform === Platform.Tizen) exporter = new TizenExporter();
	else {
		let found = false;
		for (let p in Platform) {
			if (platform === Platform[p]) {
				found = true;
				break;
			}
		}
		if (found) {
			exporter = new VisualStudioExporter();
		}
		else {
			let libsdir = path.join(from.toString(), 'Backends');
			if (fs.existsSync(libsdir) && fs.statSync(libsdir).isDirectory()) {
				let libdirs = fs.readdirSync(libsdir);
				for (let libdir of libdirs) {
					if (fs.statSync(path.join(from.toString(), 'Backends', libdir)).isDirectory()) {
						let libfiles = fs.readdirSync(path.join(from.toString(), 'Backends', libdir));
						for (let libfile of libfiles) {
							if (libfile.startsWith('Exporter') && libfile.endsWith('.js')) {
								let Exporter = require(path.relative(__dirname, path.join(from.toString(), 'Backends', libdir, libfile)));
								exporter = new Exporter();
								break;
							}
						}
					}
				}
			}
		}
	}

	if (exporter === null) {
		throw 'No exporter found for platform ' + platform + '.';
	}

	exporter.exportSolution(project, from, to, platform, options.vrApi, options.nokrafix, options);

	return project;
}

function isKoremakeProject(directory: string): boolean {
	return fs.existsSync(path.resolve(directory, 'korefile.js'));
}

async function exportProject(from: string, to: string, platform: string, options: any): Promise<Project> {
	if (isKoremakeProject(from)) {
		return exportKoremakeProject(from, to, platform, options);
	}
	else {
		throw 'korefile.js not found.';
	}
}

function compileProject(make: child_process.ChildProcess, project: Project, solutionName: string, options: any): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		make.stdout.on('data', function (data: any) {
			log.info(data.toString());
		});

		make.stderr.on('data', function (data: any) {
			log.error(data.toString());
		});

		make.on('close', function (code: number) {
			if (code === 0) {
				if ((options.customTarget && options.customTarget.baseTarget === Platform.Linux) || options.target === Platform.Linux) {
					fs.copySync(path.join(path.join(options.to.toString(), options.buildPath), solutionName), path.join(options.from.toString(), project.getDebugDir(), solutionName), { clobber: true });
				}
				else if ((options.customTarget && options.customTarget.baseTarget === Platform.Windows) || options.target === Platform.Windows) {
					fs.copySync(path.join(options.to.toString(), 'Debug', solutionName + '.exe'), path.join(options.from.toString(), project.getDebugDir(), solutionName + '.exe'), { clobber: true });
				}
				if (options.run) {
					if ((options.customTarget && options.customTarget.baseTarget === Platform.OSX) || options.target === Platform.OSX) {
						child_process.spawn('open', ['build/Release/' + solutionName + '.app/Contents/MacOS/' + solutionName], {stdio: 'inherit', cwd: options.to});
					}
					else if ((options.customTarget && (options.customTarget.baseTarget === Platform.Linux || options.customTarget.baseTarget === Platform.Windows)) || options.target === Platform.Linux || options.target === Platform.Windows) {
						child_process.spawn(path.resolve(path.join(options.from.toString(), project.getDebugDir(), solutionName)), [], {stdio: 'inherit', cwd: path.join(options.from.toString(), project.getDebugDir())});
					}
					else {
						log.info('--run not yet implemented for this platform');
					}
				}
			}
			else {
				log.error('Compilation failed.');
				process.exit(code);
			}
		});
	});
}

export let api = 2;

export async function run(options: any, loglog: any): Promise<string> {
	log.set(loglog);
	
	if (options.graphics !== undefined) {
		Options.graphicsApi = options.graphics;
	}
	
	if (options.visualstudio !== undefined) {
		Options.visualStudioVersion = options.visualstudio;	
	}

	debug = options.debug;
	
	// if (options.vr != undefined) {
	//     Options.vrApi = options.vr;
	// }
	options.buildPath = options.debug ? 'Debug' : 'Release';
	
	let project: Project = null;
	try {
		project = await exportProject(options.from, options.to, options.target, options);
	}
	catch (error) {
		log.error(error);
		return '';
	}
	let solutionName = project.getName();
	
	if (options.compile && solutionName !== '') {
		log.info('Compiling...');
		
		let make: child_process.ChildProcess = null;

		if ((options.customTarget && options.customTarget.baseTarget === Platform.Linux) || options.target === Platform.Linux) {
			make = child_process.spawn('make', [], { cwd: path.join(options.to, options.buildPath) });
		}
		else if ((options.customTarget && options.customTarget.baseTarget === Platform.OSX) || options.target === Platform.OSX) {
			make = child_process.spawn('xcodebuild', ['-project', solutionName + '.xcodeproj'], { cwd: options.to });
		}
		else if ((options.customTarget && options.customTarget.baseTarget === Platform.Windows) || options.target === Platform.Windows) {
			let vsvars: string = null;
			if (process.env.VS140COMNTOOLS) {
				vsvars = process.env.VS140COMNTOOLS + '\\vsvars32.bat';
			}
			else if (process.env.VS120COMNTOOLS) {
				vsvars = process.env.VS120COMNTOOLS + '\\vsvars32.bat';
			}
			else if (process.env.VS110COMNTOOLS) {
				vsvars = process.env.VS110COMNTOOLS + '\\vsvars32.bat';
			}
			if (vsvars !== null) {
				fs.writeFileSync(path.join(options.to, 'build.bat'), '@call "' + vsvars + '"\n' + '@MSBuild.exe "' + solutionName + '.vcxproj" /m /p:Configuration=Debug,Platform=Win32');
				make = child_process.spawn('build.bat', [], {cwd: options.to});
			}
			else {
				log.error('Visual Studio not found.');
			}
		}

		if (make !== null) {
			await compileProject(make, project, solutionName, options);
			return solutionName;
		}
		else {
			log.info('--compile not yet implemented for this platform');
			return solutionName;
		}
	}
	return solutionName;
}
