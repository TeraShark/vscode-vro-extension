# VMware vRealize Orchestrator Extension for VSCode

- Edit existing vRO Workflow Scriptable Tasks and Action code direcly by hooking straight into your linked git repo
- Create new vRO Action using a guided wizard
- Support for the following vRO runtimes
    - Javascript
    - NodeJS
    - Powershell
    - Python
- Supports artifacts from vRO >= 8.0

## Edit, lint and correct code in your existing Actions and Workflows

1. Download your vRO Repo locally
2. Open the folder using VSCode
3. Find your Workflow or Action XML file and click on it 
4. Browse the Scripts in your Workflow / Action in the vRO Code Explorer
![](/screenshots/code-outline-view.png?raw=true "Use the Extension's vRO Code Outline View to see the scripted elements in your vRO Workflows and Actions")
6. Optional: Preview the script you want to edit by right-clicking the script
7. Export the script you want to edit by right-clicking the script in the Outline View
    - This will generate a specifically-named code file in the same folder as your workflow, and will open it in the editor
8. Make your edits and corrections as you would any other code file
9. ReInject your edited script
  - You can export / reinject / preview individual scripts from Workflows: 
![](/screenshots/script-item-view.png?raw=true "Export Individual Scripts from Workflows (or Actions)")
  - You can export / reinject all scripts in a Workflow:
![](/screenshots/base-item-view.png?raw=true "Export All Scripts from Workflows (or Actions)")

## Create new vRO Actions

- Right-Click a folder in the Explorer pane in VSCode
![](/screenshots/new-action-view.png?raw=true "New Action Menu")
- If your path contains "Actions" (which is the default base location for a vRO repo for actions), VSCode will prompt for the following:
  - Action Name
  - Number of expected inputs
  -  For each input:
    - Input name
    - Input Type
  - Return type for your Action
  - Language / Runtime for your action
    - js (Regular Javascript), or
    - ps (Powershell), or
    - python (Python), or
    - node (NodeJS)
- Once completed, the extension will create a new vRO XML file and will generate and open a new code window matching the language you specified. When you're done writing your code, you will have the ability to reinject your code back into the Action XML. Easy as pie.

## Coming soon

- Create new Scripts in an existing Workflow
- Connection tools for vRO
    - Command vRO to pull the latest source
- Backlog
