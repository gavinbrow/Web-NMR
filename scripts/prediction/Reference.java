/** JVM-only fixture generator; not shipped or used at browser runtime. */
import org.openscience.cdk.DefaultChemObjectBuilder;
import org.openscience.cdk.smiles.SmilesParser;
import org.openscience.cdk.tools.CDKHydrogenAdder;
import org.openscience.cdk.tools.HOSECodeGenerator;
import org.openscience.cdk.tools.manipulator.AtomContainerManipulator;
import org.openscience.cdk.interfaces.*;
import org.openscience.cdk.config.Isotopes;
import org.openscience.nmrshiftdb.PredictionTool;
public class Reference {
  static String str(String s) {return "\""+s.replace("\\","\\\\").replace("\"","\\\"")+"\"";}
  public static void main(String[] args) throws Exception {
    var builder=DefaultChemObjectBuilder.getInstance();
    var predictor=new PredictionTool();
    int target=args[0].equals("1H")?1:6;
    System.out.print("[");
    for(int k=1;k<args.length;k++) {
      if(k>1)System.out.print(",");
      var mol=new SmilesParser(builder).parseSmiles(args[k]);
      AtomContainerManipulator.percieveAtomTypesAndConfigureAtoms(mol);
      CDKHydrogenAdder.getInstance(builder).addImplicitHydrogens(mol);
      AtomContainerManipulator.convertImplicitToExplicitHydrogens(mol);
      System.out.print("{\"smiles\":"+str(args[k])+",\"nucleus\":"+str(args[0])+",\"atoms\":[");
      for(int i=0;i<mol.getAtomCount();i++) {
        if(i>0)System.out.print(",");
        var a=mol.getAtom(i);var isotope=Isotopes.getInstance().getMajorIsotope(a.getSymbol());
        System.out.print("{\"element\":"+str(a.getSymbol())+",\"atomicNumber\":"+a.getAtomicNumber()+",\"charge\":"+a.getFormalCharge()+",\"mass\":"+isotope.getMassNumber()+"}");
      }
      System.out.print("],\"bonds\":[");
      for(int i=0;i<mol.getBondCount();i++) {
        if(i>0)System.out.print(",");var b=mol.getBond(i);
        System.out.print("["+mol.indexOf(b.getAtom(0))+","+mol.indexOf(b.getAtom(1))+","+(b.isAromatic()?4:b.getOrder().numeric())+"]");
      }
      System.out.print("],\"predictions\":[");boolean first=true;
      for(int i=0;i<mol.getAtomCount();i++) {
        var a=mol.getAtom(i);if(a.getAtomicNumber()!=target)continue;
        if(!first)System.out.print(",");first=false;
        var result=predictor.predict(mol,a,false,"Unreported");
        System.out.print("{\"atom\":"+i+",\"hose\":"+str(new HOSECodeGenerator().getHOSECode(mol,a,6))+",\"shift\":"+result[1]+",\"min\":"+result[0]+",\"max\":"+result[2]+",\"radius\":"+(int)result[4]+"}");
      }
      System.out.print("]}");
    }
    System.out.println("]");
  }
}
