/* Web NMR conversion helper, authored for Mnova's documented scripting API.
   Run this in Mnova 17+ through its scripting tools.
   The source document stays open. The exported .mnjs can be uploaded to Web NMR.
   The converter uses Mnova itself; it does not decode proprietary .mnova bytes. */
function webNmrConvertDocument() {
    var source = FileDialog.getOpenFileName("MestReNova Document (*.mnova)", "Choose a Mnova document", Dir.home());
    if (!source) return;
    if (!serialization.open(source)) {
        MessageBox.warning("The Mnova document could not be opened.");
        return;
    }
    var destination = FileDialog.getSaveFileName("MestReNova JSON Document (*.mnjs)", "Save a Web NMR compatible copy", source.replace(/\.mnova$/i, ".mnjs"));
    if (!destination) return;
    if (!/\.mnjs$/i.test(destination)) destination += ".mnjs";
    serialization.save(destination, "MestReNova JSON Document (*.mnjs *.zip)");
}
webNmrConvertDocument();
