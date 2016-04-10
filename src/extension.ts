import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    var guides = new Guides();
    context.subscriptions.push(new GuidesController(guides));
    context.subscriptions.push(guides);
}

class GuidesController {
    private guides: Guides;
    private disposable: vscode.Disposable;

    constructor(guides: Guides){
        this.guides = guides;
        this.guides.reset();

        let subscriptions: vscode.Disposable[] = [];
        vscode.window.onDidChangeTextEditorSelection(
            this.updateSelection, this, subscriptions
        );
        vscode.window.onDidChangeActiveTextEditor(
            this.updateActiveEditor, this, subscriptions
        );
        vscode.workspace.onDidChangeConfiguration(
            this.updateEditors, this, subscriptions
        );

        this.disposable = vscode.Disposable.from(...subscriptions);
    }

    dispose(){
        this.disposable.dispose();
    }

    private updateSelection(event: vscode.TextEditorSelectionChangeEvent){
        this.guides.setNeedsUpdateEditor(event.textEditor);
    }

    private updateActiveEditor(editor: vscode.TextEditor){
        this.guides.setNeedsUpdateEditor(editor);
    }

    private updateEditors(){
        this.guides.reset();
    }
}

class Guides {
    private indentGuideDecor: vscode.TextEditorDecorationType;
    private activeGuideDecor: vscode.TextEditorDecorationType;
    private rulerGuideDecor: vscode.TextEditorDecorationType;
    private indentBackgroundDecors: Array<vscode.TextEditorDecorationType>;

    private hasShowSuggestion = false;
    private hasWarnDeprecate = false;

    private configurations: vscode.WorkspaceConfiguration;

    private timerDelay = 0.1;
    private updateTimer: number = null;

    reset(){
        this.clearEditorsDecorations();
        this.dispose();
        this.loadSettings();
        this.updateEditors();
    }

    dispose(){
        if(this.updateTimer !== null){
            clearTimeout(this.updateTimer);
        }
        if(this.indentGuideDecor){
            this.indentGuideDecor.dispose();
        }
        if(this.activeGuideDecor){
            this.activeGuideDecor.dispose();
        }
        if(this.rulerGuideDecor){
            this.rulerGuideDecor.dispose();
        }
    }

    loadSettings(){
        this.configurations = vscode.workspace.getConfiguration("guides");

        this.timerDelay = this.configurations.get<number>("updateDelay");
        this.indentBackgroundDecors = [];
        if(
            this.configurations.has("normal.backgrounds") &&
            !this.hasWarnDeprecate
        ){
            this.hasWarnDeprecate = true;
            vscode.window.showWarningMessage(
                "Guides extension has detected that you are still using " +
                "\"guides.normal.backgrounds\" settings. " +
                "Please change the settings to "+
                "\"guides.indent.backgrounds\" instead."
            );
        }
        this.configurations.get<any>(
            "normal.backgrounds",
            this.configurations.get<any>(
                "indent.backgrounds"
            )
        ).forEach((backgroundColor) => {
            this.indentBackgroundDecors.push(
                vscode.window.createTextEditorDecorationType({
                    backgroundColor: backgroundColor
                })
            );
        });
        this.indentGuideDecor = vscode.window.createTextEditorDecorationType({
            outlineWidth: this.configurations.get<string>("normal.width"),
            outlineColor: this.configurations.get<string>("normal.color"),
            outlineStyle: this.configurations.get<string>("normal.style")
        });
        this.activeGuideDecor = vscode.window.createTextEditorDecorationType({
            outlineWidth: this.configurations.get<string>("active.width"),
            outlineColor: this.configurations.get<string>("active.color"),
            outlineStyle: this.configurations.get<string>("active.style")
        });
        this.rulerGuideDecor = vscode.window.createTextEditorDecorationType({
            outlineWidth: this.configurations.get<string>("ruler.width"),
            outlineColor: this.configurations.get<string>("ruler.color"),
            outlineStyle: this.configurations.get<string>("ruler.style")
        });
    }

    clearEditorsDecorations(){
        vscode.window.visibleTextEditors.forEach((editor) => {
            if(this.indentBackgroundDecors){
                this.indentBackgroundDecors.forEach((decoration) => {
                    editor.setDecorations(decoration, []);
                });
            }
            if(this.indentGuideDecor){
                editor.setDecorations(this.indentGuideDecor, []);
            }
            if(this.activeGuideDecor){
                editor.setDecorations(this.activeGuideDecor, []);
            }
            if(this.rulerGuideDecor){
                editor.setDecorations(this.rulerGuideDecor, []);
            }
        });
    }

    setNeedsUpdateEditor(editor: vscode.TextEditor){
        if(this.updateTimer !== null){
            return;
        }
        this.updateTimer = setTimeout(() => {
            this.updateTimer = null;
            this.updateEditor(editor);
        }, this.timerDelay * 1000);
    }

    updateEditors(){
        vscode.window.visibleTextEditors.forEach((editor) => {
            this.updateEditor(editor);
        });
    }

    updateEditor(editor: vscode.TextEditor){
        // If no editor set, do nothing
        //   This can occur when active editor is not set
        if(!editor){
            return;
        }

        var indentGuideRanges: vscode.Range[] = [];
        var indentBackgrounds: any[] = [];
        var activeGuideRanges: vscode.Range[] = [];
        var rulerRanges: vscode.Range[] = [];
        var maxLevel = this.indentBackgroundDecors.length;

        var cursorPosition = editor.selection.active;
        var primaryRanges = this.getRangesForLine(
            editor, cursorPosition.line, maxLevel
        );
        var stillActive = (
            primaryRanges.activeGuideRange !== null &&
            editor.selection.isEmpty &&
            this.configurations.get<boolean>(
                "active.enabled"
            )
        );
        indentGuideRanges.push(
            ...primaryRanges.indentGuideRanges
        );
        indentBackgrounds.push(
            ...primaryRanges.indentBackgrounds
        );
        if(primaryRanges.activeGuideRange){
            if(stillActive){
                activeGuideRanges.push(
                    primaryRanges.activeGuideRange
                );
            }else{
                indentGuideRanges.push(
                    primaryRanges.activeGuideRange
                );
            }
        }
        rulerRanges.push(
            ...primaryRanges.rulerRanges
        );

        // Search through upper ranges
        for(var line = cursorPosition.line - 1; line >= 0; line--){
            var ranges = this.getRangesForLine(
                editor, line, maxLevel, primaryRanges.activeLevel
            );
            indentGuideRanges.push(
                ...ranges.indentGuideRanges
            );
            indentBackgrounds.push(
                ...ranges.indentBackgrounds
            );
            if(ranges.activeGuideRange){
                if(stillActive){
                    activeGuideRanges.push(
                        ranges.activeGuideRange
                    );
                }else{
                    indentGuideRanges.push(
                        ranges.activeGuideRange
                    );
                }
            }else if(primaryRanges.activeLevel !== ranges.activeLevel){
                stillActive = false;
            }
            rulerRanges.push(
                ...ranges.rulerRanges
            );
        }

        // Search through lower ranges
        stillActive = (
            primaryRanges.activeGuideRange !== null &&
            editor.selection.isEmpty &&
            this.configurations.get<boolean>(
                "active.enabled"
            )
        );
        var totalLines = editor.document.lineCount;
        for(var line = cursorPosition.line + 1; line < totalLines; line++){
            var ranges = this.getRangesForLine(
                editor, line, maxLevel, primaryRanges.activeLevel
            );
            indentGuideRanges.push(
                ...ranges.indentGuideRanges
            );
            indentBackgrounds.push(
                ...ranges.indentBackgrounds
            );
            if(ranges.activeGuideRange){
                if(stillActive){
                    activeGuideRanges.push(
                        ranges.activeGuideRange
                    );
                }else{
                    indentGuideRanges.push(
                        ranges.activeGuideRange
                    );
                }
            }else if(primaryRanges.activeLevel !== ranges.activeLevel){
                stillActive = false;
            }
            rulerRanges.push(
                ...ranges.rulerRanges
            );
        }

        this.indentBackgroundDecors.forEach((decoration, level) => {
            editor.setDecorations(decoration, indentBackgrounds.filter(
                (stopPoint) => {
                    return (
                        stopPoint.level % maxLevel === level
                    );
                }
            ).map((stopPoint) => {
                return stopPoint.range;
            }));
        });
        editor.setDecorations(this.indentGuideDecor, indentGuideRanges);
        editor.setDecorations(this.activeGuideDecor, activeGuideRanges);
        editor.setDecorations(this.rulerGuideDecor, rulerRanges);
    }

    getRangesForLine(editor: vscode.TextEditor, lineNumber: number,
                     maxLevel: number, activeLevel: number = -1){
        var activeGuideRange: vscode.Range = null;
        var indentGuideRanges: vscode.Range[] = [];
        var indentBackgrounds: any[] = [];
        var rulerRanges: vscode.Range[] = [];

        var guidelines = this.getGuides(
            editor.document.lineAt(lineNumber), editor.options.tabSize
        );
        if(activeLevel === -1){
            for (var index = guidelines.length - 1; index >= 0; index--) {
                var guide = guidelines[index];
                if(guide.type === "normal"){
                    activeLevel = index;
                    break;
                }
            }
            if(activeLevel < 0){
                activeLevel = -2;
            }
        }

        var lastPosition = new vscode.Position(lineNumber, 0);
        guidelines.forEach((guideline, level) => {
            var position = new vscode.Position(lineNumber, guideline.position);
            var inSelection = false;
            editor.selections.forEach((selection) => {
                if(selection.contains(position)){
                    inSelection = true;
                    return;
                }
            });
            if(guideline.type === "normal" || guideline.type === "extra"){
                // Add background color stop points if there are colors
                if(maxLevel > 0 && (!inSelection || (
                    inSelection &&
                    !this.configurations.get<boolean>(
                        "indent.hideBackgroundOnSelection"
                    )
                ))){
                    indentBackgrounds.push({
                        level: level,
                        range: new vscode.Range(
                            lastPosition, position
                        )
                    });
                }
                if(guideline.type === "normal"){
                    if(level === activeLevel && (
                        !inSelection || (inSelection &&
                            !this.configurations.get<boolean>(
                                "active.hideOnSelection"
                            )
                        )
                    )){
                        activeGuideRange = new vscode.Range(position, position);
                    }else if(level !== activeLevel && (
                        !inSelection || (inSelection &&
                            !this.configurations.get<boolean>(
                                "normal.hideOnSelection"
                            )
                        )
                    )){
                        indentGuideRanges.push(
                            new vscode.Range(position, position)
                        );
                    }
                }
            }else if(guideline.type === "ruler"){
                if(
                    !this.configurations.get<boolean>("overrideDefault") &&
                    !this.hasShowSuggestion &&
                    this.isEqualOrNewerVersionThan(0, 10, 10)
                ){
                    this.hasShowSuggestion = true;
                    vscode.window.showInformationMessage(
                        "Visual Studio Code has built-in ruler" +
                        " feature. Guides extension kindly " +
                        "suggests that you use built-in feature "+
                        "rather than using this extension."
                    );
                }
                if(
                    !inSelection || (
                        inSelection &&
                        !this.configurations.get<boolean>(
                            "ruler.hideOnSelection"
                        )
                    )
                ){
                    rulerRanges.push(new vscode.Range(position, position));
                }
            }
            lastPosition = position;
        });

        if(guidelines.length !== 0 && activeGuideRange === null){
            activeLevel = -1;
        }

        return {
            indentGuideRanges: indentGuideRanges,
            indentBackgrounds: indentBackgrounds,
            activeLevel: activeLevel,
            activeGuideRange: activeGuideRange,
            rulerRanges: rulerRanges
        };
    }

    getGuides(line: vscode.TextLine, indentSize: number){
        if(line.isEmptyOrWhitespace){
            return [];
        }
        var pattern = new RegExp(
            ` {${indentSize}}| {0,${indentSize - 1}}\t`,
            "g"
        );
        var emptySpace = " ".repeat(indentSize);
        var guides = [];
        var whitespaces = line.text.substr(
            0, line.firstNonWhitespaceCharacterIndex
        );
        var singleMatch = whitespaces.match(pattern);

        this.configurations.get<Array<number>>("rulers").forEach((stop) => {
            var sourceIndex = 0;
            var index = 0;
            if(stop < line.text.replace(pattern, emptySpace).length){
                if(singleMatch){
                    singleMatch.forEach((match) => {
                        sourceIndex += match.length;
                        index += indentSize;
                    });
                }
                guides.push({
                    type: "ruler",
                    position: sourceIndex + stop - index
                });
            }
        });

        if(!singleMatch || singleMatch.length == 0){
            return guides;
        }
        var index = 0;
        for(
            var indentLevel=0;
            indentLevel < singleMatch.length;
            indentLevel++
        ){
            index += singleMatch[indentLevel].length;
            guides.push({
                type: (
                    index === line.firstNonWhitespaceCharacterIndex
                ) ? "extra" : "normal",
                position: index
            });
        }
        return guides;
    }

    isEqualOrNewerVersionThan(major: number, minor: number, patch: number){
        var targetVersions = [major, minor, patch];
        var currentVersions = vscode.version.split(".").map((value)=>{
            return parseInt(value);
        });
        for (var index = 0; index < targetVersions.length; index++) {
            var targetVersion = targetVersions[index];
            var currentVersion = currentVersions[index];
            if(currentVersion < targetVersion){
                return false;
            }
        }
        return true;
    }
}
